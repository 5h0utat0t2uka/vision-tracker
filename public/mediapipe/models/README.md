# MediaPipe models

`efficientdet-lite0-int8-v1.tflite` is the EfficientDet-Lite0 int8 v1 model published by Google for MediaPipe Object Detector.

- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite
- SHA-256 (SRI): `sha256-ByC/JHvXbmWU6ij6nG98UkK+d0gYmX277/xNpGDHI7s=`
- SHA-256 (hex): `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`
- Input size: 320 x 320
- Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector#efficientdet-lite0_model_recommended

`efficientdet-lite0-float16-v1.tflite` is the EfficientDet-Lite0 float16 v1 model, used only when selecting `GPU · float16`.

- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite
- SHA-256 (hex): `4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993`
- Size: 7,254,339 bytes
- Input size: 320 x 320

`efficientdet-lite2-int8-v1.tflite` is the EfficientDet-Lite2 int8 v1 model, used with the CPU delegate.

- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/int8/1/efficientdet_lite2.tflite
- SHA-256 (hex): `b3f50554cb0ea559e90328845f7d9ba4d13c8bff372914d24e06bc8bb72fa896`
- Size: 7,515,971 bytes
- Input size: 448 x 448

`efficientdet-lite2-float16-v1.tflite` is the EfficientDet-Lite2 float16 v1 model, used with the GPU delegate.

- Source: https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite
- SHA-256 (hex): `5d4ebec1029bc9907aeadb9e7b4ac9cb1da6a19d01ad375210a9ae18ba173302`
- Size: 12,138,859 bytes
- Input size: 448 x 448
- Model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/object_detector#efficientdet-lite2_model

The models are intentionally committed so development and production builds do not depend on a runtime CDN. Only the selected model is fetched by the browser. Update the versioned filename, source URL, hash tests, and the exact exclusion in `nix/pre-commit.nix` together.
