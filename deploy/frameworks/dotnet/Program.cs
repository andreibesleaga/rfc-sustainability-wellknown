// ASP.NET Core 8/9 minimal API: one endpoint. The document is a content file next to the app.
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var doc = File.ReadAllBytes(Path.Combine(app.Environment.ContentRootPath, "sustainability-data"));

app.MapMethods("/.well-known/sustainability-data", new[] { "GET", "HEAD" }, (HttpContext ctx) =>
{
    var h = ctx.Response.Headers;
    h.ContentType = "application/sustainability-data+json";
    h["X-Content-Type-Options"] = "nosniff";
    h["Access-Control-Allow-Origin"] = "*";
    h.CacheControl = "public, max-age=86400";
    return HttpMethods.IsHead(ctx.Request.Method) ? Results.Empty : Results.Bytes(doc, "application/sustainability-data+json");
});
// Other methods on that path: ASP.NET answers 405 with Allow for a MapMethods endpoint.
app.Run();
