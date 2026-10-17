import com.android.build.gradle.internal.dsl.BaseFlavor

android {
    namespace = "com.rninspector.kotlin"

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
        }
        create("prod") {
            dimension = "tier"
        }
    }
}
