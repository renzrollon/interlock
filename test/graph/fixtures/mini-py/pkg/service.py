from pkg.util import Gate, normalize


def run(user: str) -> str:
    gate = Gate()
    if not gate.allow(user):
        return "denied"
    return normalize(user)
