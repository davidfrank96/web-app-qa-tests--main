# Media Fixtures

`sample-video.mp4` is a tiny deterministic MP4 fixture for INSSA live video capsule testing.

The live video lifecycle test must use this static file or an explicit `INSSA_TEST_VIDEO_FIXTURE_PATH` override. Do not add runtime FFmpeg/video synthesis back into the test path.

Current fixture:

- Path: `tests/fixtures/media/sample-video.mp4`
- Type: MP4 / ISO Base Media
- Size: approximately 4.7 KB
- Purpose: verify one-video upload lifecycle without depending on local FFmpeg features.
