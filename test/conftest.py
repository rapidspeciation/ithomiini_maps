"""No test may use Franz's AI subscriptions (his rule, 9 Nov 2026: "I never want a test to use my ai subscriptions").

The pytest side of test/no-ai-core.mjs: in every pytest run it refuses, and writes down,
  - starting a model CLI (claude, codex, t3, opencode, gemini, ...), wacli or ssh, unless it is a stub a test wrote in a
    temporary folder or in test/ (the real ones are also shadowed on PATH by test/no-ai-bin);
  - a connection to an AI host (Anthropic, OpenAI, Gemini's API, OpenRouter, ElevenLabs, ...) or to T3 Code (its public
    hosts, and 127.0.0.1:3773-3775), refused before any name lookup, so it needs no network;
and takes the AI tokens and the AI and T3 addresses out of the environment. An attempt fails the test it happened in.
"""
import os
import re
import shutil
import socket
import subprocess
import tempfile

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SHIMS = os.path.join(HERE, "no-ai-bin")
CLIS = {"claude", "codex", "t3", "opencode", "gemini", "ollama", "aider", "cursor-agent", "qwen", "crush", "goose", "amp",
        "llm", "deepseek", "wacli", "ssh"}
AI_HOSTS = ("anthropic.com", "claude.ai", "claude.com", "openai.com", "chatgpt.com", "oaiusercontent.com", "openrouter.ai",
            "generativelanguage.googleapis.com", "aiplatform.googleapis.com", "elevenlabs.io", "deepseek.com", "mistral.ai",
            "groq.com", "x.ai", "cohere.ai", "cohere.com", "together.xyz", "together.ai", "perplexity.ai", "z.ai",
            "bigmodel.cn", "moonshot.ai", "moonshot.cn", "fireworks.ai", "replicate.com", "opencode.ai",
            "api-inference.huggingface.co")
T3_HOSTS = ("t3.codes", "t3.ithomiini-ikiam.com")
T3_PORTS = {3773, 3774, 3775}
SECRET_ENV = re.compile(r"^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_MESSAGING_|OPENAI_|AI_API_KEY$|AI_MODEL$|ITHOMIINI_AI_|"
                        r"ITHOMIINI_T3_|T3CODE_|CLAUDE_CONFIG_DIR$|CODEX_HOME$|T3_URL$|GEMINI_|GOOGLE_API_KEY$|ELEVENLABS_|"
                        r"OPENROUTER_|DEEPSEEK_|MISTRAL_|GROQ_|OLLAMA_HOST$|WA_)")

_attempts = []
_log = os.path.join(tempfile.gettempdir(), f"no-ai-guard-py-{os.getpid()}.log")


def _stub(path):
    path = os.path.abspath(path)
    inside = lambda d: path == d or path.startswith(d.rstrip(os.sep) + os.sep)
    return (inside(tempfile.gettempdir()) or inside("/tmp") or inside(HERE)) and not inside(SHIMS)


def blocked_cli(cmd, env=None):
    """The real CLI a command would start, or None."""
    name = os.path.basename(str(cmd))
    if name not in CLIS:
        return None
    if "/" in str(cmd):
        return None if _stub(os.path.abspath(str(cmd))) else str(cmd)
    found = shutil.which(str(cmd), path=(env or os.environ).get("PATH"))
    if not found:
        return None
    return found if found.startswith(SHIMS + os.sep) or not _stub(found) else None


def blocked_host(host, port=None):
    h = str(host or "").lower().rstrip(".").strip("[]")
    if h in ("", "localhost", "::1", "0.0.0.0", "::") or h.startswith("127."):
        return f"T3 port {h or 'localhost'}:{port}" if port in T3_PORTS else None
    if any(h == d or h.endswith("." + d) for d in AI_HOSTS):
        return f"AI host {h}:{port}"
    if any(h == d or h.endswith("." + d) for d in T3_HOSTS):
        return f"T3 host {h}:{port}"
    return None


def _refuse(kind, target):
    line = f"no-ai guard: refused {kind} {target} (test {os.environ.get('PYTEST_CURRENT_TEST', '?')})"
    _attempts.append(line)
    return line


for _k in list(os.environ):
    if SECRET_ENV.match(_k):
        del os.environ[_k]
os.environ["PATH"] = SHIMS + os.pathsep + os.environ.get("PATH", "")
os.environ["NOAI_GUARD_LOGS"] = _log

_getaddrinfo = socket.getaddrinfo


def _guarded_getaddrinfo(host, port, *args, **kwargs):
    why = blocked_host(host.decode() if isinstance(host, bytes) else host, port)
    if why:
        raise ConnectionRefusedError(_refuse("connection to", why))
    return _getaddrinfo(host, port, *args, **kwargs)


_connect, _connect_ex = socket.socket.connect, socket.socket.connect_ex


def _check_address(address):
    if isinstance(address, tuple) and len(address) >= 2:
        why = blocked_host(address[0], address[1])
        if why:
            raise ConnectionRefusedError(_refuse("connection to", why))


def _guarded_connect(self, address):
    _check_address(address)
    return _connect(self, address)


def _guarded_connect_ex(self, address):
    _check_address(address)
    return _connect_ex(self, address)


_popen_init = subprocess.Popen.__init__


def _guarded_popen(self, args, *rest, **kwargs):
    env = kwargs.get("env")
    if kwargs.get("shell") or isinstance(args, (str, bytes)):
        line = args.decode() if isinstance(args, bytes) else (args if isinstance(args, str) else " ".join(map(str, args)))
        words = re.findall(r"(?:^|[;&|(`\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*([^\s;&|()`'\"<>]+)", line)
        hit = next((h for h in (blocked_cli(w, env) for w in words) if h), None)
    else:
        hit = blocked_cli(list(args)[0], env)
    if hit:
        _refuse("CLI", f"{hit} ({args!r:.160})")
        args, kwargs = ["/bin/sh", "-c", f"echo 'no-ai guard: {os.path.basename(hit)} is not started in tests' >&2; exit 1"], {
            **kwargs, "shell": False, "executable": None}
    return _popen_init(self, args, *rest, **kwargs)


socket.getaddrinfo = _guarded_getaddrinfo
socket.socket.connect = _guarded_connect
socket.socket.connect_ex = _guarded_connect_ex
subprocess.Popen.__init__ = _guarded_popen


def take_attempts():
    """The attempts since the last call: this process's, and the PATH shim's (a script that called a CLI by name)."""
    fresh = list(_attempts)
    _attempts.clear()
    if os.path.exists(_log):
        with open(_log) as fh:
            fresh += [l for l in fh.read().splitlines() if l]
        os.remove(_log)
    return fresh


@pytest.fixture(autouse=True)
def _no_ai():
    yield
    fresh = take_attempts()
    if fresh:
        pytest.fail("\n".join(fresh) + "\nTests use fakes, never a model CLI, an AI host or T3 (test/conftest.py).", pytrace=False)


def pytest_sessionfinish(session, exitstatus):
    left = take_attempts()
    if left:
        print("\n" + "\n".join(left) + f"\nno-ai guard: {len(left)} attempt(s) outside a test: the run fails.")
        session.exitstatus = 1
