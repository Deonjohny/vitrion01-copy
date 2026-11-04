"""Authenticated field encryption; database identifiers are authenticated, not encrypted."""
import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class FieldCipher:
    def __init__(self, key: bytes):
        if len(key) != 32:
            raise ValueError("AES-256 requires a 32-byte key")
        self._cipher = AESGCM(key)

    @staticmethod
    def _aad(case_id: str, field: str) -> bytes:
        return f"v1:case:{case_id}:field:{field}".encode()

    def encrypt(self, value: str, case_id: str, field: str) -> str:
        nonce = os.urandom(12)
        encrypted = self._cipher.encrypt(nonce, value.encode(), self._aad(case_id, field))
        return "v1:" + base64.b64encode(nonce + encrypted).decode()

    def decrypt(self, value: str, case_id: str, field: str) -> str:
        if not value.startswith("v1:"):
            raise ValueError("Unsupported ciphertext version")
        payload = base64.b64decode(value[3:], validate=True)
        if len(payload) < 28:
            raise ValueError("Truncated ciphertext")
        return self._cipher.decrypt(payload[:12], payload[12:], self._aad(case_id, field)).decode()
