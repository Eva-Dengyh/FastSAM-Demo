import numpy as np

from app.utils.mask_encoder import encode_mask_rle, mask_to_bbox


class TestEncodeMaskRle:
    def test_all_zeros(self):
        mask = np.zeros((3, 4), dtype=np.uint8)
        result = encode_mask_rle(mask)
        assert result["size"] == [3, 4]
        assert result["counts"] == [12]

    def test_all_ones(self):
        mask = np.ones((2, 3), dtype=np.uint8)
        result = encode_mask_rle(mask)
        assert result["size"] == [2, 3]
        # 先 0 个 0，再 6 个 1
        assert result["counts"] == [0, 6]

    def test_alternating_pattern(self):
        # [0, 1, 0, 1] → counts: [1, 1, 1, 1]
        mask = np.array([[0, 1, 0, 1]], dtype=np.uint8)
        result = encode_mask_rle(mask)
        assert result["counts"] == [1, 1, 1, 1]
        assert result["size"] == [1, 4]

    def test_block_pattern(self):
        # [0, 0, 1, 1, 0] → counts: [2, 2, 1]
        mask = np.array([[0, 0, 1, 1, 0]], dtype=np.uint8)
        result = encode_mask_rle(mask)
        assert result["counts"] == [2, 2, 1]

    def test_bool_input(self):
        mask = np.array([[True, True, False]], dtype=bool)
        result = encode_mask_rle(mask)
        assert result["counts"] == [0, 2, 1]


class TestMaskToBbox:
    def test_normal_mask(self):
        mask = np.zeros((10, 10), dtype=np.uint8)
        mask[2:5, 3:7] = 1
        bbox = mask_to_bbox(mask)
        assert bbox == [3, 2, 6, 4]

    def test_single_pixel(self):
        mask = np.zeros((5, 5), dtype=np.uint8)
        mask[2, 3] = 1
        bbox = mask_to_bbox(mask)
        assert bbox == [3, 2, 3, 2]

    def test_empty_mask(self):
        mask = np.zeros((5, 5), dtype=np.uint8)
        bbox = mask_to_bbox(mask)
        assert bbox == [0, 0, 0, 0]
