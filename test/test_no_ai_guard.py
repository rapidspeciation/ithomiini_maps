"""The guard of test/conftest.py: AI hosts, T3 and model CLIs refused (offline) and written down; stubs still run."""
import os
import socket
import subprocess
import tempfile
import urllib.request

import pytest

from conftest import SHIMS, blocked_host, take_attempts


def test_env_and_path():
    assert os.environ["PATH"].split(os.pathsep)[0] == SHIMS
    for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "T3CODE_HOME", "T3CODE_PORT", "CLAUDE_CONFIG_DIR"):
        assert k not in os.environ, k


def test_ai_host_t3_and_cli_refused():
    with pytest.raises(OSError):
        urllib.request.urlopen("https://api.anthropic.com/v1/messages", timeout=5)
    with pytest.raises(OSError):
        socket.create_connection(("127.0.0.1", 3774), timeout=1)
    assert subprocess.run(["codex", "exec", "hola"], capture_output=True).returncode == 1
    assert subprocess.run("cd /tmp && claude -p hola", shell=True, capture_output=True).returncode == 1
    got = take_attempts()
    assert len(got) == 4, got
    assert "AI host api.anthropic.com:443" in got[0]
    assert "T3 port 127.0.0.1:3774" in got[1]
    assert "refused CLI" in got[2] and "codex" in got[2]
    assert "refused CLI" in got[3] and "claude" in got[3]


def test_stub_and_other_hosts_allowed():
    d = tempfile.mkdtemp(prefix="no-ai-stub-")
    stub = os.path.join(d, "claude")
    with open(stub, "w") as fh:
        fh.write('#!/bin/sh\necho stub "$@"\n')
    os.chmod(stub, 0o755)
    assert subprocess.run([stub, "x"], capture_output=True, text=True).stdout == "stub x\n"
    assert blocked_host("api.gbif.org", 443) is None
    assert blocked_host("127.0.0.1", 8080) is None
    assert take_attempts() == []
