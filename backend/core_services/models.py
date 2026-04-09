from pydantic import BaseModel
from typing import Dict, Any


class InvocationRequest(BaseModel):
    """Request model for Core-Services invocations"""

    input: Dict[str, Any]
