"""The guard of test/conftest.py: AI hosts, T3 and model CLIs refused (offline) and written down; stubs still run."""
import os
import socket
import subprocess
import tempfile
import urllib.request

import pytest

from no_ai_guard import SHIMS, blocked_host, blocked_in_shell, take_attempts


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


# Round 3 (review 9 Nov): os-level starts, a shell given a path, Python and node children, T3 ports on any address.
def test_os_level_shell_and_children():
    assert os.system("bash -c '/opt/elsewhere/claude -p hola'") == 256
    with pytest.raises(PermissionError):
        os.execv("/opt/elsewhere/codex", ["codex", "exec"])
    with pytest.raises(PermissionError):
        os.posix_spawn("/usr/bin/env", ["env", "PATH=/usr/bin", "opencode", "run"], dict(os.environ))
    assert subprocess.run(["bash", "-lc", "command -v gemini"], capture_output=True).returncode == 1
    # A Python child given its own env: guarded, reports here; so is a node child.
    py = "import socket\ntry: socket.create_connection(('api.openai.com', 443), timeout=2)\nexcept OSError: pass"
    import sys
    r = subprocess.run([sys.executable, "-c", py], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    subprocess.run(["node", "-e", "fetch('http://127.0.0.1:3774/').catch(() => {})"], capture_output=True)
    with pytest.raises(OSError):
        socket.create_connection(("100.83.134.33", 3775), timeout=1)
    got = take_attempts()
    assert len(got) == 7, got
    assert "/opt/elsewhere/claude" in got[0] and "codex" in got[1] and "opencode" in got[2] and "gemini" in got[3]
    assert "AI host api.openai.com:443" in got[4]
    assert "T3 port 127.0.0.1:3774" in got[5]
    assert "T3 port 100.83.134.33:3775" in got[6]


# Round 4 (review 9 Nov): os.execve / os.posix_spawn with their own env keep the guard; ordinary shell lines run.
def test_exec_and_spawn_with_own_env_keep_the_guard():
    import sys
    probe = "import sys; print('no_ai_guard' in sys.modules)"
    execve = f"import os, sys; os.execve(sys.executable, [sys.executable, '-c', {probe!r}], {{'PATH': '/usr/bin:/bin'}})"
    assert subprocess.run([sys.executable, "-c", execve], capture_output=True, text=True).stdout.strip() == "True"
    r, w = os.pipe()
    pid = os.posix_spawn(sys.executable, [sys.executable, "-c", probe], {"PATH": "/usr/bin:/bin"}, file_actions=[(os.POSIX_SPAWN_DUP2, w, 1)])
    os.close(w)
    os.waitpid(pid, 0)
    assert os.read(r, 100).decode().strip() == "True"
    for line in ("ls /etc/ssh", 'grep -c "claude" notes.txt', "git log -- server/t3", "cat docs/amp"):
        assert blocked_in_shell(line) is None, line
    assert blocked_in_shell(f"ls -l '{SHIMS}/claude'")
    assert take_attempts() == []
