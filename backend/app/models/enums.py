import enum


class LogEventType(str, enum.Enum):
    ENTRY = "entry"
    EXIT = "exit"
    REGISTRATION = "registration"


class VisitorStatus(str, enum.Enum):
    VALID = "valid"
    ENTERED = "entered"
    OVERSTAYED = "overstayed"
    EXPIRED = "expired"
    PENDING = "pending"
    REJECTED = "rejected"


class AlertSeverity(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
