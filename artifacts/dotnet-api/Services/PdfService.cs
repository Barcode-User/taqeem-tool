using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;

namespace TaqeemApi.Services;

public class PdfService
{
    public string ExtractText(string filePath)
    {
        var sb = new System.Text.StringBuilder();
        using var reader = new PdfReader(filePath);
        using var doc = new PdfDocument(reader);
        for (int i = 1; i <= doc.GetNumberOfPages(); i++)
        {
            sb.AppendLine(PdfTextExtractor.GetTextFromPage(doc.GetPage(i)));
        }
        return sb.ToString();
    }
}
