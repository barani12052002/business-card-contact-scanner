import argparse
import json
import os
from pathlib import Path
from opencv_card_processor import preprocess_image

os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--side-len", type=int, default=960)
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()

    ocr = PaddleOCR(
    lang="en",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    text_det_limit_side_len=640,
)
    results = {}

    for image in args.images:
        image_path = Path(image)

        print(f"[OpenCV] Processing image: {image_path.name}")

        processed_image = preprocess_image(str(image_path))

        print("[OpenCV] ✓ Edge detection completed")
        print("[OpenCV] ✓ Perspective correction completed")
        print("[OpenCV] ✓ Image enhanced for OCR")

        prediction = ocr.predict(processed_image)
        if not prediction:
            results[image_path.name] = {"rawText": "", "lines": []}
            continue

        item = prediction[0]
        data = dict(item)
        texts = [str(text) for text in data.get("rec_texts", [])]
        scores = [float(score) for score in data.get("rec_scores", [])]
        boxes = data.get("rec_boxes", [])

        lines = []
        for index, text in enumerate(texts):
            box = boxes[index].tolist() if index < len(boxes) and hasattr(boxes[index], "tolist") else None
            lines.append(
                {
                    "text": text,
                    "score": scores[index] if index < len(scores) else None,
                    "box": box,
                }
            )

        results[image_path.name] = {
            "rawText": "\n".join(texts),
            "lines": lines,
        }

    Path(args.output).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    if hasattr(ocr, "close"):
        ocr.close()
    os._exit(0)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise