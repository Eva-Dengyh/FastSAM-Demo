import numpy as np


def encode_mask_rle(mask: np.ndarray) -> dict:
    """
    将 binary mask 编码为 RLE 格式。

    RLE 从 0 开始交替计数：第一个数是连续 0 的个数，
    第二个数是连续 1 的个数，依此类推。

    Args:
        mask: shape (H, W)，值为 bool 或 0/1

    Returns:
        {"counts": [int, ...], "size": [H, W]}
    """
    pixels = mask.flatten().astype(np.uint8)
    counts: list[int] = []
    current_val = 0
    current_count = 0

    for pixel in pixels:
        if pixel == current_val:
            current_count += 1
        else:
            counts.append(current_count)
            current_val = 1 - current_val
            current_count = 1

    counts.append(current_count)
    return {"counts": counts, "size": [int(mask.shape[0]), int(mask.shape[1])]}


def mask_to_bbox(mask: np.ndarray) -> list[int]:
    """
    从 binary mask 提取边界框。

    Args:
        mask: shape (H, W)，值为 bool 或 0/1

    Returns:
        [x_min, y_min, x_max, y_max]
    """
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return [0, 0, 0, 0]
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
