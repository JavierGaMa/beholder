import com.android.build.gradle.internal.dsl.BaseFlavor

android {
    namespace = "com.rninspector.kotlin"

    defaultConfig {
        applicationId = "com.rninspector.kotlin"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        getByName("debug") {
            applicationIdSuffix = ".debug"
        }
        create("qa") {
            isDebuggable = true
        }
    }

    productFlavors {
        create("dev") {
            dimension = "tier"
            applicationIdSuffix = ".dev"
        }
        create("prod") {
            dimension = "tier"
        }
    }
}
