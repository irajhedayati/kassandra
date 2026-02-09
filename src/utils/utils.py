import uuid

def uuid_validator(val: str):
    try:
        uuid.UUID(val)
        return True
    except (ValueError, AttributeError, TypeError):
        return False

def noop_validator(_):
    return True