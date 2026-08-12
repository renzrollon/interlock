def normalize(value: str) -> str:
    return value.strip().lower()


class Gate:
    def allow(self, user: str) -> bool:
        return bool(user)
