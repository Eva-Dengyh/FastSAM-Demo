from pydantic import BaseModel


class UploadResponse(BaseModel):
    image_id: str
    width: int
    height: int
