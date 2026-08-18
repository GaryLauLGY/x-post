import AppKit
import Foundation
import Vision

struct ScreenshotMetrics: Codable {
    let path: String
    let replies: Int
    let reposts: Int
    let likes: Int
    let bookmarks: Int
    let bodyLines: [String]
    let recognized: [String]
}

func compactNumber(_ source: String) -> Int? {
    let cleaned = source
        .replacingOccurrences(of: ",", with: "")
        .replacingOccurrences(of: " ", with: "")
        .replacingOccurrences(of: "O", with: "0")
        .replacingOccurrences(of: "o", with: "0")
    let pattern = #"([0-9]+(?:\.[0-9]+)?)(万|[kK])?"#
    guard let expression = try? NSRegularExpression(pattern: pattern),
          let match = expression.firstMatch(in: cleaned, range: NSRange(cleaned.startIndex..., in: cleaned)),
          let valueRange = Range(match.range(at: 1), in: cleaned),
          let value = Double(cleaned[valueRange]) else {
        return nil
    }
    let suffix = match.range(at: 2).location == NSNotFound
        ? ""
        : String(cleaned[Range(match.range(at: 2), in: cleaned)!])
    let multiplier: Double = suffix == "万" ? 10_000 : (suffix.lowercased() == "k" ? 1_000 : 1)
    return Int((value * multiplier).rounded())
}

func extractMetrics(at path: String) throws -> ScreenshotMetrics {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url),
          let representation = image.representations.first else {
        throw NSError(domain: "ScreenshotMetrics", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read image"])
    }

    let imageHeight = max(1, representation.pixelsHigh)
    let bodyTopInset = min(0.35, 100.0 / Double(imageHeight))
    let bodyBottomInset = min(0.42, 150.0 / Double(imageHeight))
    let bodyRequest = VNRecognizeTextRequest()
    bodyRequest.recognitionLevel = .accurate
    bodyRequest.recognitionLanguages = ["zh-Hans", "en-US"]
    bodyRequest.usesLanguageCorrection = false
    bodyRequest.regionOfInterest = CGRect(
        x: 0.025,
        y: bodyBottomInset,
        width: 0.95,
        height: max(0.05, 1 - bodyTopInset - bodyBottomInset)
    )
    let footerHeight = min(0.26, 100.0 / Double(imageHeight))
    let regions = [
        CGRect(x: 0.07, y: 0, width: 0.15, height: footerHeight),
        CGRect(x: 0.29, y: 0, width: 0.14, height: footerHeight),
        CGRect(x: 0.51, y: 0, width: 0.16, height: footerHeight),
        CGRect(x: 0.73, y: 0, width: 0.16, height: footerHeight),
    ]
    let accurateRequests = regions.map { region in
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        request.regionOfInterest = region
        return request
    }
    let fastRequests = regions.map { region in
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .fast
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = false
        request.regionOfInterest = region
        return request
    }
    let handler = VNImageRequestHandler(url: url)
    try handler.perform([bodyRequest] + accurateRequests + fastRequests)

    let bodyLines = (bodyRequest.results ?? [])
        .compactMap { observation -> (String, CGFloat)? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            return (candidate.string, observation.boundingBox.midY)
        }
        .sorted { $0.1 > $1.1 }
        .map(\.0)

    var values = [0, 0, 0, 0]
    var recognized: [String] = []
    for index in regions.indices {
        let accurate = (accurateRequests[index].results ?? []).flatMap { $0.topCandidates(3) }
        let fast = (fastRequests[index].results ?? []).flatMap { $0.topCandidates(3) }
        let parsed = (accurate + fast).compactMap { compactNumber($0.string) }
        values[index] = parsed.max() ?? 0
        let labels = (accurate.map { "a:\($0.string)" } + fast.map { "f:\($0.string)" }).joined(separator: "|")
        if !labels.isEmpty { recognized.append("\(index):\(labels)") }
    }

    return ScreenshotMetrics(
        path: path,
        replies: values[0],
        reposts: values[1],
        likes: values[2],
        bookmarks: values[3],
        bodyLines: bodyLines,
        recognized: recognized.sorted()
    )
}

let paths = CommandLine.arguments.dropFirst()
let results = paths.compactMap { path -> ScreenshotMetrics? in
    do {
        return try extractMetrics(at: path)
    } catch {
        FileHandle.standardError.write(Data("\(path): \(error.localizedDescription)\n".utf8))
        return nil
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try encoder.encode(results))
