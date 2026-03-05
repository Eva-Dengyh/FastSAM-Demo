from pydantic import BaseModel, Field


class PointInput(BaseModel):
    """单个点击坐标"""

    x: int = Field(..., ge=0, description="x 坐标（原图像素）")
    y: int = Field(..., ge=0, description="y 坐标（原图像素）")
    label: int = Field(default=1, ge=0, le=1, description="1=前景 0=背景")


class SegmentRequest(BaseModel):
    """分割请求"""

    image_id: str = Field(..., description="图片唯一标识")
    points: list[PointInput] = Field(..., min_length=1, description="点击坐标列表")


class RLEMask(BaseModel):
    """RLE 编码的 binary mask"""

    counts: list[int] = Field(..., description="游程编码数组")
    size: list[int] = Field(..., min_length=2, max_length=2, description="[height, width]")


class MaskResult(BaseModel):
    """单个分割结果"""

    rle: RLEMask
    bbox: list[int] = Field(..., min_length=4, max_length=4, description="[x_min, y_min, x_max, y_max]")
    score: float = Field(..., ge=0, le=1, description="置信度")
    area: int = Field(..., ge=0, description="mask 像素面积")


class SegmentResponse(BaseModel):
    """分割响应"""

    masks: list[MaskResult]
    image_id: str
