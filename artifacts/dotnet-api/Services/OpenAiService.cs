using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TaqeemApi.Models;

namespace TaqeemApi.Services;

public class OpenAiService(IConfiguration config, ILogger<OpenAiService> logger)
{
    private readonly string _apiKey = config["OpenAI:ApiKey"] ?? throw new InvalidOperationException("OpenAI:ApiKey is not configured");
    private readonly string _baseUrl = config["OpenAI:BaseUrl"] ?? "https://api.openai.com/v1";
    private readonly string _model = config["OpenAI:Model"] ?? "gpt-4o";

    public async Task<Report> ExtractReportDataAsync(string pdfText, string originalFileName)
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        var jsonSchema = """
            {
              "reportNumber": "string", "reportDate": "string", "valuationDate": "string",
              "inspectionDate": "string", "commissionDate": "string", "requestNumber": "string",
              "valuerName": "string", "licenseNumber": "string", "valuerMobile": "string",
              "valuerEmail": "string", "companyName": "string", "clientName": "string",
              "clientId": "string", "clientType": "string", "clientEmail": "string",
              "clientPhone": "string", "ownerName": "string", "ownerId": "string",
              "propertyType": "string", "propertyUse": "string", "propertyDescription": "string",
              "region": "string", "city": "string", "district": "string", "street": "string",
              "deedNumber": "string", "deedDate": "string", "deedIssuer": "string",
              "planNumber": "string", "pieceNumber": "string",
              "landArea": 0, "buildingArea": 0, "floorsCount": 0, "age": 0,
              "coordinates": "string", "streetFacades": "string", "streetWidth": 0,
              "utilities": "string", "permittedFloorsCount": 0, "permittedBuildingRatio": 0,
              "landValue": 0, "buildingValue": 0, "finalValue": 0,
              "valuationMethod": "string", "valuationPurpose": "string", "notes": "string"
            }
            """;

        var prompt =
            "أنت مساعد متخصص في استخراج بيانات تقارير التقييم العقاري السعودية.\n" +
            "استخرج البيانات التالية من نص تقرير التقييم وأرجعها بتنسيق JSON فقط.\n\n" +
            "النص:\n" + pdfText + "\n\n" +
            "أرجع JSON بهذه الحقول (استخدم null للحقول غير الموجودة):\n" + jsonSchema;

        var requestBody = new
        {
            model = _model,
            messages = new[]
            {
                new { role = "user", content = prompt }
            },
            response_format = new { type = "json_object" },
            temperature = 0.1
        };

        var content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");
        var response = await http.PostAsync($"{_baseUrl}/chat/completions", content);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var doc = JsonDocument.Parse(json);
        var messageContent = doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "{}";

        var extracted = JsonDocument.Parse(messageContent).RootElement;
        var report = new Report { OriginalFileName = originalFileName };
        MapExtractedData(extracted, report);
        return report;
    }

    private static void MapExtractedData(JsonElement el, Report r)
    {
        r.ReportNumber = GetString(el, "reportNumber");
        r.ReportDate = GetString(el, "reportDate");
        r.ValuationDate = GetString(el, "valuationDate");
        r.InspectionDate = GetString(el, "inspectionDate");
        r.CommissionDate = GetString(el, "commissionDate");
        r.RequestNumber = GetString(el, "requestNumber");
        r.ValuerName = GetString(el, "valuerName");
        r.LicenseNumber = GetString(el, "licenseNumber");
        r.ValuerMobile = GetString(el, "valuerMobile");
        r.ValuerEmail = GetString(el, "valuerEmail");
        r.CompanyName = GetString(el, "companyName");
        r.ClientName = GetString(el, "clientName");
        r.ClientId = GetString(el, "clientId");
        r.ClientType = GetString(el, "clientType");
        r.ClientEmail = GetString(el, "clientEmail");
        r.ClientPhone = GetString(el, "clientPhone");
        r.OwnerName = GetString(el, "ownerName");
        r.OwnerId = GetString(el, "ownerId");
        r.PropertyType = GetString(el, "propertyType");
        r.PropertyUse = GetString(el, "propertyUse");
        r.PropertyDescription = GetString(el, "propertyDescription");
        r.Region = GetString(el, "region");
        r.City = GetString(el, "city");
        r.District = GetString(el, "district");
        r.Street = GetString(el, "street");
        r.DeedNumber = GetString(el, "deedNumber");
        r.DeedDate = GetString(el, "deedDate");
        r.DeedIssuer = GetString(el, "deedIssuer");
        r.PlanNumber = GetString(el, "planNumber");
        r.PieceNumber = GetString(el, "pieceNumber");
        r.LandArea = GetDecimal(el, "landArea");
        r.BuildingArea = GetDecimal(el, "buildingArea");
        r.FloorsCount = GetInt(el, "floorsCount");
        r.Age = GetInt(el, "age");
        r.Coordinates = GetString(el, "coordinates");
        r.StreetFacades = GetString(el, "streetFacades");
        r.StreetWidth = GetDecimal(el, "streetWidth");
        r.Utilities = GetString(el, "utilities");
        r.PermittedFloorsCount = GetInt(el, "permittedFloorsCount");
        r.PermittedBuildingRatio = GetDecimal(el, "permittedBuildingRatio");
        r.LandValue = GetDecimal(el, "landValue");
        r.BuildingValue = GetDecimal(el, "buildingValue");
        r.FinalValue = GetDecimal(el, "finalValue");
        r.ValuationMethod = GetString(el, "valuationMethod");
        r.ValuationPurpose = GetString(el, "valuationPurpose");
        r.Notes = GetString(el, "notes");
    }

    private static string? GetString(JsonElement el, string key)
    {
        if (el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
            return v.GetString();
        return null;
    }

    private static decimal? GetDecimal(JsonElement el, string key)
    {
        if (el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number)
            return v.GetDecimal();
        return null;
    }

    private static int? GetInt(JsonElement el, string key)
    {
        if (el.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number)
            return v.GetInt32();
        return null;
    }
}
