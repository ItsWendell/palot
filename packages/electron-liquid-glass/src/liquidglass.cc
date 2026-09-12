#include <napi.h>
#include <string>

#ifdef __APPLE__
extern "C" int AddGlassEffectView(unsigned char *buffer, bool opaque);
extern "C" void RemoveGlassEffectView(int viewId);
extern "C" void ConfigureGlassView(int viewId, double cornerRadius, const char *tintHex, const char *appearance);
extern "C" void SetGlassViewIntProperty(int viewId, const char *key, long long value);
extern "C" void SetGlassViewStringProperty(int viewId, const char *key, const char *value);
extern "C" void SetGlassViewAppearance(int viewId, const char *appearance);
extern "C" void SetGlassViewTintColor(int viewId, const char *tintHex);
#endif

// Create a class that will be exposed to JavaScript
class LiquidGlassNative : public Napi::ObjectWrap<LiquidGlassNative>
{
public:
  // This static method defines the class for JavaScript
  static Napi::Object Init(Napi::Env env, Napi::Object exports)
  {
    // Define the JavaScript class with method(s)
    Napi::Function func = DefineClass(env, "LiquidGlassNative", {InstanceMethod("addView", &LiquidGlassNative::AddView), InstanceMethod("removeView", &LiquidGlassNative::RemoveView), InstanceMethod("setVariant", &LiquidGlassNative::SetVariant), InstanceMethod("setScrimState", &LiquidGlassNative::SetScrimState), InstanceMethod("setSubduedState", &LiquidGlassNative::SetSubduedState), InstanceMethod("setAppearance", &LiquidGlassNative::SetAppearance), InstanceMethod("setTintColor", &LiquidGlassNative::SetTintColor)});

    // Create a persistent reference to the constructor
    Napi::FunctionReference *constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    // Set the constructor on the exports object
    exports.Set("LiquidGlassNative", func);
    return exports;
  }

  // Constructor
  LiquidGlassNative(const Napi::CallbackInfo &info)
      : Napi::ObjectWrap<LiquidGlassNative>(info) {}

private:
  // New AddView method
  Napi::Value AddView(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsBuffer())
    {
      Napi::TypeError::New(env, "Expected first argument to be a Buffer returned by getNativeWindowHandle()").ThrowAsJavaScriptException();
      return env.Null();
    }

    double radius = 0.0;
    std::string tint;
    bool opaque = false;
    std::string appearance = "system";
    if (info.Length() >= 2 && info[1].IsObject())
    {
      auto obj = info[1].As<Napi::Object>();
      if (obj.Has("cornerRadius") && obj.Get("cornerRadius").IsNumber())
      {
        radius = obj.Get("cornerRadius").As<Napi::Number>().DoubleValue();
      }
      if (obj.Has("tintColor") && obj.Get("tintColor").IsString())
      {
        tint = obj.Get("tintColor").As<Napi::String>().Utf8Value();
      }
      if (obj.Has("opaque") && obj.Get("opaque").IsBoolean())
      {
        opaque = obj.Get("opaque").As<Napi::Boolean>().Value();
      }
      if (obj.Has("appearance") && obj.Get("appearance").IsString())
      {
        appearance = obj.Get("appearance").As<Napi::String>().Utf8Value();
      }
    }

    auto buffer = info[0].As<Napi::Buffer<unsigned char>>();

#ifdef __APPLE__
    int viewId = AddGlassEffectView(buffer.Data(), opaque);
    if (viewId >= 0)
    {
      ConfigureGlassView(viewId, radius, tint.c_str(), appearance.c_str());
    }
    return Napi::Number::New(env, viewId);
#else
    // Not supported on this platform yet
    return Napi::Number::New(env, -1);
#endif
  }

  Napi::Value SetVariant(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
      Napi::TypeError::New(env, "Expected (id:number, variant:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    long long variant = info[1].As<Napi::Number>().Int64Value();
    ApplyIntProp(id, "variant", variant);
    return env.Undefined();
  }

  Napi::Value RemoveView(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
    {
      Napi::TypeError::New(env, "Expected (id:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
#ifdef __APPLE__
    RemoveGlassEffectView(id);
#endif
    return env.Undefined();
  }

  Napi::Value SetScrimState(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
      Napi::TypeError::New(env, "Expected (id:number, scrim:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    long long scrim = info[1].As<Napi::Number>().Int64Value();
    ApplyIntProp(id, "scrimState", scrim);
    return env.Undefined();
  }

  Napi::Value SetSubduedState(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
      Napi::TypeError::New(env, "Expected (id:number, subdued:number)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    long long subd = info[1].As<Napi::Number>().Int64Value();
    ApplyIntProp(id, "subduedState", subd);
    return env.Undefined();
  }

  Napi::Value SetAppearance(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString())
    {
      Napi::TypeError::New(env, "Expected (id:number, appearance:string)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    std::string appearance = info[1].As<Napi::String>().Utf8Value();
#ifdef __APPLE__
    SetGlassViewAppearance(id, appearance.c_str());
#endif
    return env.Undefined();
  }

  Napi::Value SetTintColor(const Napi::CallbackInfo &info)
  {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString())
    {
      Napi::TypeError::New(env, "Expected (id:number, tintColor:string)").ThrowAsJavaScriptException();
      return env.Null();
    }
    int id = info[0].As<Napi::Number>().Int32Value();
    std::string tintColor = info[1].As<Napi::String>().Utf8Value();
#ifdef __APPLE__
    SetGlassViewTintColor(id, tintColor.c_str());
#endif
    return env.Undefined();
  }

  static void ApplyIntProp(int id, const char *key, long long v)
  {
#ifdef __APPLE__
    SetGlassViewIntProperty(id, key, v);
#endif
  }
};

// Initialize the addon
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
  return LiquidGlassNative::Init(env, exports);
}

// Register the initialization function
NODE_API_MODULE(liquidglass, Init)
