import argparse
from opencv_card_processor import preprocess_image

parser = argparse.ArgumentParser()
parser.add_argument("image")
args = parser.parse_args()

output = preprocess_image(args.image)

print(output)