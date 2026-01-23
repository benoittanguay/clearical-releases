{
  "targets": [
    {
      "target_name": "media_monitor",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [
        "src/media_monitor.mm",
        "src/system_audio_capture.mm",
        "src/mic_capture.mm",
        "src/index.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": ["-fobjc-arc"]
          },
          "link_settings": {
            "libraries": [
              "-framework CoreAudio",
              "-framework AVFoundation",
              "-framework CoreMediaIO",
              "-framework IOKit",
              "-framework Foundation",
              "-framework ScreenCaptureKit",
              "-framework CoreMedia",
              "-framework Accelerate"
            ]
          }
        }]
      ]
    }
  ]
}
