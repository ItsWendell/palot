{
    "targets": [
        {
            "target_name": "liquidglass",
            "sources": ["src/liquidglass.cc", "src/glass_effect.mm"],
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "include",
            ],
            "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
            "defines": ["NODE_ADDON_API_CPP_EXCEPTIONS"],
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "cflags_cc": ["-std=c++17"],
            "xcode_settings": {
                "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
                "CLANG_CXX_LIBRARY": "libc++",
                "MACOSX_DEPLOYMENT_TARGET": "10.14",
                "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
                "OTHER_LDFLAGS": ["-framework AppKit"],
            },
            "msvs_settings": {"VCCLCompilerTool": {"ExceptionHandling": 1}},
        }
    ]
}
