from ssl import (
    PROTOCOL_TLSv1_2,
    PROTOCOL_SSLv23,
    PROTOCOL_TLS,
    PROTOCOL_TLS_CLIENT,
    PROTOCOL_TLS_SERVER,
    PROTOCOL_TLSv1,
    PROTOCOL_TLSv1_1
)


def ssl_protocol(name: str):
    if name == 'PROTOCOL_TLSv1_2':
        return PROTOCOL_TLSv1_2
    if name == 'PROTOCOL_SSLv23':
        return PROTOCOL_SSLv23
    if name == 'PROTOCOL_TLS':
        return PROTOCOL_TLS
    if name == 'PROTOCOL_TLS_CLIENT':
        return PROTOCOL_TLS_CLIENT
    if name == 'PROTOCOL_TLS_SERVER':
        return PROTOCOL_TLS_SERVER
    if name == 'PROTOCOL_TLSv1':
        return PROTOCOL_TLSv1
    if name == 'PROTOCOL_TLSv1_1':
        return PROTOCOL_TLSv1_1

    raise ValueError(name + 'is not a supported SSL protocol')

supported_ssl_protocols = [
    "PROTOCOL_TLSv1_2",
    "PROTOCOL_SSLv23",
    "PROTOCOL_TLS",
    "PROTOCOL_TLS_CLIENT",
    "PROTOCOL_TLS_SERVER",
    "PROTOCOL_TLSv1",
    "PROTOCOL_TLSv1_1"
]