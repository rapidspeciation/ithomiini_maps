"""No test may use Franz's AI subscriptions (his rule, 9 Nov 2026): the guard of test/no_ai_guard.py in every pytest
run (and, through PYTHONPATH and NODE_OPTIONS, in the processes the tests start). An attempt fails the test it happened in.
"""
import pytest

from no_ai_guard import take_attempts


@pytest.fixture(autouse=True)
def _no_ai():
    yield
    fresh = take_attempts()
    if fresh:
        pytest.fail("\n".join(fresh) + "\nTests use fakes, never a model CLI, an AI host or T3 (test/no_ai_guard.py).", pytrace=False)


def pytest_sessionfinish(session, exitstatus):
    left = take_attempts()
    if left:
        print("\n" + "\n".join(left) + f"\nno-ai guard: {len(left)} attempt(s) outside a test: the run fails.")
        session.exitstatus = 1
