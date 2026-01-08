#!/usr/bin/env swift

import Foundation
import Vision
import AppKit

// MARK: - Prompt Configuration
struct PromptConfig: Codable {
    let systemPrompt: String
    let analysisPrompts: AnalysisPrompts
    let descriptionTemplate: DescriptionTemplate
}

struct AnalysisPrompts: Codable {
    let documentType: PromptSection
    let technicalContext: PromptSection
    let activityType: ActivitySection
}

struct PromptSection: Codable {
    let description: String
    let keywords: [String: String]
}

struct ActivitySection: Codable {
    let description: String
    let patterns: [String: [String]]
}

struct DescriptionTemplate: Codable {
    let format: String
    let structure: [String]
}

// MARK: - Models
struct AnalysisRequest: Codable {
    let imagePath: String
    let requestId: String?
}

struct AnalysisResponse: Codable {
    let success: Bool
    let requestId: String?
    let description: String?
    let confidence: Float?
    let error: String?
    let detectedText: [String]?
    let objects: [String]?
}

// MARK: - Screenshot Analyzer
class ScreenshotAnalyzer {
    private var promptConfig: PromptConfig?

    init() {
        loadPromptConfig()
    }

    private func loadPromptConfig() {
        let promptPath = URL(fileURLWithPath: #file).deletingLastPathComponent().appendingPathComponent("prompts.json").path

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: promptPath))
            promptConfig = try JSONDecoder().decode(PromptConfig.self, from: data)
        } catch {
            print("Failed to load prompt config: \(error)")
            // Use default config as fallback
            promptConfig = createDefaultPromptConfig()
        }
    }

    private func createDefaultPromptConfig() -> PromptConfig {
        return PromptConfig(
            systemPrompt: "Analyze desktop screenshots to understand work activities.",
            analysisPrompts: AnalysisPrompts(
                documentType: PromptSection(description: "Document analysis", keywords: [:]),
                technicalContext: PromptSection(description: "Technical analysis", keywords: [:]),
                activityType: ActivitySection(description: "Activity analysis", patterns: [:])
            ),
            descriptionTemplate: DescriptionTemplate(format: "Detailed screenshot analysis", structure: [])
        )
    }
    func analyzeImage(at path: String, completion: @escaping (AnalysisResponse) -> Void) {
        guard let image = NSImage(contentsOfFile: path),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            completion(AnalysisResponse(
                success: false,
                requestId: nil,
                description: nil,
                confidence: nil,
                error: "Could not load image from path: \(path)",
                detectedText: nil,
                objects: nil
            ))
            return
        }

        var detectedText: [String] = []
        var detectedObjects: [String] = []
        var analysisDescription = ""
        var confidenceScore: Float = 0.0

        // Use a semaphore to synchronize async Vision operations
        let semaphore = DispatchSemaphore(value: 0)
        var completedTasks = 0
        let totalTasks = 2

        // Perform text recognition (only if macOS 10.15+ available)
        if #available(macOS 10.15, *) {
            let textRequest = VNRecognizeTextRequest { request, error in
                defer {
                    completedTasks += 1
                    if completedTasks == totalTasks { semaphore.signal() }
                }

                if let observations = request.results as? [VNRecognizedTextObservation] {
                    for observation in observations {
                        if let topCandidate = observation.topCandidates(1).first {
                            detectedText.append(topCandidate.string)
                        }
                    }
                }
            }

            textRequest.recognitionLevel = .accurate
            textRequest.usesLanguageCorrection = true

            let textHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try textHandler.perform([textRequest])
            } catch {
                completedTasks += 1
                if completedTasks == totalTasks { semaphore.signal() }
            }
        } else {
            completedTasks += 1
            if completedTasks == totalTasks { semaphore.signal() }
        }

        // Perform object classification (only if macOS 10.15+ available)
        if #available(macOS 10.15, *) {
            let classificationRequest = VNClassifyImageRequest { request, error in
                defer {
                    completedTasks += 1
                    if completedTasks == totalTasks { semaphore.signal() }
                }

                if let observations = request.results as? [VNClassificationObservation] {
                    // Get top 5 classifications above 10% confidence
                    let significantObjects = observations
                        .filter { $0.confidence > 0.1 }
                        .prefix(5)
                        .map { $0.identifier }

                    detectedObjects = Array(significantObjects)

                    // Use the top classification for confidence
                    if let topResult = observations.first {
                        confidenceScore = topResult.confidence
                    }
                }
            }

            let classificationHandler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try classificationHandler.perform([classificationRequest])
            } catch {
                completedTasks += 1
                if completedTasks == totalTasks { semaphore.signal() }
            }
        } else {
            completedTasks += 1
            if completedTasks == totalTasks { semaphore.signal() }
        }

        // Wait for all Vision tasks to complete
        _ = semaphore.wait(timeout: .now() + 10)

        // Generate natural language description
        analysisDescription = self.generateDescription(
            detectedText: detectedText,
            detectedObjects: detectedObjects,
            imagePath: path
        )

        completion(AnalysisResponse(
            success: true,
            requestId: nil,
            description: analysisDescription,
            confidence: confidenceScore > 0 ? confidenceScore : 0.8,
            error: nil,
            detectedText: detectedText.isEmpty ? nil : detectedText,
            objects: detectedObjects.isEmpty ? nil : detectedObjects
        ))
    }

    private func generateDescription(detectedText: [String], detectedObjects: [String], imagePath: String) -> String {
        // Extract app info from filename
        let filename = URL(fileURLWithPath: imagePath).lastPathComponent
        let appInfo = extractAppInfoFromFilename(filename)
        let allText = detectedText.joined(separator: " ").lowercased()

        // Analyze content for context clues
        let wordCount = detectedText.reduce(0) { $0 + $1.components(separatedBy: .whitespaces).count }
        let textSample = detectedText.prefix(15).joined(separator: " ")

        // Detect programming keywords and patterns
        let hasCodeKeywords = allText.contains("function") || allText.contains("class") ||
                              allText.contains("const") || allText.contains("import") ||
                              allText.contains("export") || allText.contains("async") ||
                              allText.contains("return") || allText.contains("interface") ||
                              allText.contains("type") || allText.contains("var") || allText.contains("let")

        let hasDebugKeywords = allText.contains("error") || allText.contains("warning") ||
                               allText.contains("failed") || allText.contains("debug") ||
                               allText.contains("exception") || allText.contains("stack trace")

        let hasWebKeywords = allText.contains("http") || allText.contains("api") ||
                            allText.contains("endpoint") || allText.contains("request") ||
                            allText.contains("response") || allText.contains("json")

        let hasDocKeywords = allText.contains("documentation") || allText.contains("readme") ||
                            allText.contains("guide") || allText.contains("tutorial") ||
                            allText.contains("implementation")

        let hasTestKeywords = allText.contains("test") || allText.contains("spec") ||
                             allText.contains("expect") || allText.contains("assert") ||
                             allText.contains("jest") || allText.contains("mocha")

        // Detect specific technologies
        var detectedTechnologies: [String] = []
        let techKeywords = [
            ("react", "React"), ("typescript", "TypeScript"), ("javascript", "JavaScript"),
            ("swift", "Swift"), ("python", "Python"), ("electron", "Electron"),
            ("node", "Node.js"), ("npm", "npm"), ("git", "Git"),
            ("docker", "Docker"), ("kubernetes", "Kubernetes"), ("aws", "AWS"),
            ("figma", "Figma"), ("jira", "Jira"), ("slack", "Slack")
        ]

        for (keyword, tech) in techKeywords {
            if allText.contains(keyword) && detectedTechnologies.count < 3 {
                detectedTechnologies.append(tech)
            }
        }

        // Build natural, verbose description with variety
        var description = ""

        // Get app name and window title
        let appName = appInfo.appName ?? "Unknown"
        let windowTitle = appInfo.windowTitle?.replacingOccurrences(of: "_", with: " ")
        let appLower = appName.lowercased()

        // Choose one of several opening styles for variety
        let openingStyle = Int.random(in: 0...3)

        switch openingStyle {
        case 0:
            // Style 1: Direct activity description
            description += "The user is working in \(appName)"
            if let title = windowTitle, !title.isEmpty && title != "Unknown" {
                description += " with '\(title)' open"
            }
            description += ". "
        case 1:
            // Style 2: Context-first approach
            if hasCodeKeywords {
                description += "This screenshot shows active development work in \(appName). "
            } else if hasDebugKeywords {
                description += "The user appears to be troubleshooting or debugging an issue in \(appName). "
            } else {
                description += "The screen displays \(appName) being used for focused work. "
            }
        case 2:
            // Style 3: Task-oriented opening
            if appLower.contains("cursor") || appLower.contains("vscode") || appLower.contains("xcode") {
                description += "A code editor session in \(appName) is shown, "
                if let title = windowTitle, !title.isEmpty {
                    description += "specifically working on '\(title)'. "
                } else {
                    description += "with the user actively coding. "
                }
            } else if appLower.contains("browser") || appLower.contains("safari") || appLower.contains("chrome") {
                description += "The user is browsing or researching in \(appName)"
                if let title = windowTitle, !title.isEmpty && title != "Unknown" {
                    description += ", viewing '\(title)'"
                }
                description += ". "
            } else {
                description += "Working in \(appName), the user appears engaged with their current task. "
            }
        default:
            // Style 4: Window-title focused
            if let title = windowTitle, !title.isEmpty && title != "Unknown" {
                description += "The screenshot captures \(appName) displaying '\(title)'. "
            } else {
                description += "\(appName) is the active application in this work session. "
            }
        }

        // Add specific activity details based on content analysis
        if hasCodeKeywords && wordCount > 20 {
            let codePatterns = detectCodePatterns(text: textSample)
            if !codePatterns.isEmpty {
                description += "The visible code includes \(codePatterns.joined(separator: ", ")), suggesting active software development. "
            } else {
                description += "Multiple lines of source code are visible, indicating programming work in progress. "
            }
        } else if hasCodeKeywords {
            description += "Programming code is visible on the screen. "
        }

        if hasDebugKeywords {
            description += "Error messages or debugging output are present, indicating the user is troubleshooting an issue. "
        }

        // Add technology context if detected
        if !detectedTechnologies.isEmpty {
            let techList = detectedTechnologies.count > 1
                ? detectedTechnologies.dropLast().joined(separator: ", ") + " and " + detectedTechnologies.last!
                : detectedTechnologies[0]

            if detectedTechnologies.count == 1 {
                description += "The work involves \(techList). "
            } else {
                description += "Technologies in use include \(techList). "
            }
        }

        // Add detail about text content if substantial
        if wordCount > 30 {
            description += "The screen contains approximately \(wordCount) words of text, "
            if hasDocKeywords {
                description += "appearing to be documentation or written materials. "
            } else if hasCodeKeywords {
                description += "consisting primarily of code and technical content. "
            } else {
                description += "indicating substantial content being worked on. "
            }
        } else if wordCount > 10 {
            description += "Several lines of text are visible on screen. "
        }

        // Add specific content samples for extra detail when available
        if !detectedText.isEmpty && textSample.count > 20 {
            let preview = String(textSample.prefix(120))
            if preview.contains("function") || preview.contains("const") || preview.contains("class") {
                // Don't show raw code as it can be messy
                description += "The code structure suggests organized software development practices. "
            } else if !hasCodeKeywords && wordCount < 100 {
                // For non-code content, sometimes include a snippet
                let cleanPreview = preview.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
                if cleanPreview.count > 20 && cleanPreview.count < 80 && !cleanPreview.contains("http") {
                    description += "Visible text includes: '\(cleanPreview)...'. "
                }
            }
        }

        // Add web-specific details
        if hasWebKeywords {
            description += "API or web development content is visible, suggesting work on web services or HTTP integration. "
        }

        // Add test-specific details
        if hasTestKeywords {
            description += "Test code or testing frameworks are present, indicating the user is writing or reviewing automated tests. "
        }

        // Add closing context based on app type and content
        if appLower.contains("cursor") || appLower.contains("vscode") || appLower.contains("xcode") {
            let closings = [
                "This appears to be a focused coding session.",
                "The developer is actively working on implementation.",
                "Software development work is in progress."
            ]
            description += closings[Int.random(in: 0..<closings.count)]
        } else if appLower.contains("terminal") || appLower.contains("iterm") {
            description += "Command-line operations are being performed, typical of system administration or development workflows."
        } else if appLower.contains("figma") || appLower.contains("sketch") {
            description += "Design work is underway in this creative tool."
        } else if appLower.contains("browser") {
            if hasCodeKeywords || hasDocKeywords {
                description += "The browsing appears to be related to technical research or documentation review."
            } else {
                description += "Web-based work or research is taking place."
            }
        } else {
            // Generic but varied closings
            let genericClosings = [
                "The user is engaged in productive work.",
                "This captures an active work session.",
                "Focused work activity is evident."
            ]
            if wordCount > 20 {
                description += genericClosings[Int.random(in: 0..<genericClosings.count)]
            }
        }

        return description.isEmpty ? "Working on their computer in \(appName)." : description
    }

    // Helper to detect specific code patterns for more detailed descriptions
    private func detectCodePatterns(text: String) -> [String] {
        var patterns: [String] = []
        let lowerText = text.lowercased()

        if lowerText.contains("function") || lowerText.contains("=>") {
            patterns.append("function definitions")
        }
        if lowerText.contains("class") || lowerText.contains("interface") {
            patterns.append("class or interface declarations")
        }
        if lowerText.contains("import") || lowerText.contains("export") {
            patterns.append("module imports")
        }
        if lowerText.contains("const") || lowerText.contains("let") || lowerText.contains("var") {
            patterns.append("variable declarations")
        }
        if lowerText.contains("async") || lowerText.contains("await") {
            patterns.append("asynchronous code")
        }
        if lowerText.contains("return") {
            patterns.append("return statements")
        }

        return patterns
    }

    private func extractAppInfoFromFilename(_ filename: String) -> (appName: String?, windowTitle: String?) {
        // Parse filename format: timestamp_AppName_WindowTitle.png
        let components = filename.replacingOccurrences(of: ".png", with: "").components(separatedBy: "_")

        guard components.count >= 3 else { return (nil, nil) }

        let appName = components[1].replacingOccurrences(of: "_", with: " ")
        let windowTitle = components.dropFirst(2).joined(separator: " ").replacingOccurrences(of: "_", with: " ")

        return (appName, windowTitle)
    }

    private func analyzeDocumentType(_ text: String, config: PromptConfig) -> [String] {
        var types: [String] = []

        for (keyword, description) in config.analysisPrompts.documentType.keywords {
            if text.contains(keyword.lowercased()) {
                types.append(description)
            }
        }

        return types
    }

    private func analyzeTechnicalContext(_ text: String, config: PromptConfig) -> [String] {
        var technologies: [String] = []

        for (keyword, description) in config.analysisPrompts.technicalContext.keywords {
            if text.contains(keyword.lowercased()) {
                technologies.append(description)
            }
        }

        return technologies
    }

    private func analyzeWorkActivity(_ text: String, config: PromptConfig) -> [String] {
        var activities: [String] = []

        for (activityType, patterns) in config.analysisPrompts.activityType.patterns {
            let matchCount = patterns.filter { text.contains($0.lowercased()) }.count
            if matchCount >= 2 {
                activities.append("\(activityType.capitalized) activity detected (matched \(matchCount) patterns)")
            }
        }

        return activities
    }

    private func generateProductivityAssessment(appName: String?, documentType: [String], technologies: [String], activities: [String]) -> String {
        var assessment = "PRODUCTIVITY ASSESSMENT:\n"

        if let app = appName {
            switch app.lowercased() {
            case "cursor", "xcode", "vscode", "intellij":
                assessment += "- Development environment detected - likely coding/programming work\n"
            case "figma", "sketch", "photoshop":
                assessment += "- Design tool detected - likely creative/UI work\n"
            case "browser", "safari", "chrome", "firefox":
                assessment += "- Web browser detected - likely research/web-based work\n"
            default:
                assessment += "- Application: \(app)\n"
            }
        }

        if !technologies.isEmpty {
            assessment += "- Technical focus: \(technologies.joined(separator: ", "))\n"
        }

        if !documentType.isEmpty {
            assessment += "- Document focus: \(documentType.joined(separator: ", "))\n"
        }

        if !activities.isEmpty {
            assessment += "- Primary activities: \(activities.joined(separator: ", "))\n"
        }

        return assessment
    }

    private func analyzeTextContent(_ textLines: [String]) -> [String] {
        let allText = textLines.joined(separator: " ").lowercased()
        var context: [String] = []

        // Detect document type (prioritized)
        if allText.contains("implementation") || allText.contains("plan") {
            context.append("Implementation documentation")
        } else if allText.contains("readme") || allText.contains("documentation") {
            context.append("Project documentation")
        }

        // Detect programming context
        let codeKeywords = ["function", "class", "import", "export", "const", "var", "return", "if", "async"]
        let foundCodeKeywords = codeKeywords.filter { allText.contains($0) }
        if foundCodeKeywords.count >= 2 {
            context.append("Code editing")
        }

        // Detect configuration
        if allText.contains("config") || allText.contains("settings") {
            context.append("Configuration")
        }

        // Detect debugging
        if allText.contains("error") || allText.contains("debug") || allText.contains("failed") {
            context.append("Debugging")
        }

        return context
    }

    private func categorizeObjectsDetailed(_ objects: [String]) -> [String] {
        var categories: [String] = []
        let objectsLower = objects.map { $0.lowercased() }

        // Development environment detection
        if objectsLower.contains(where: { $0.contains("computer") || $0.contains("display") || $0.contains("screen") }) {
            categories.append("development environment")
        }

        // User interface elements
        if objectsLower.contains(where: { $0.contains("window") || $0.contains("interface") || $0.contains("menu") }) {
            categories.append("user interface elements")
        }

        // Text/document content
        if objectsLower.contains(where: { $0.contains("text") || $0.contains("document") || $0.contains("page") }) {
            categories.append("text content")
        }

        return categories
    }

    private func detectTechnicalContent(_ textLines: [String]) -> String {
        let allText = textLines.joined(separator: " ").lowercased()

        // Detect specific technologies (prioritized)
        let techKeywords = [
            "electron": "Electron",
            "swift": "Swift",
            "react": "React",
            "typescript": "TypeScript",
            "javascript": "JavaScript",
            "api": "API",
            "git": "Git",
            "npm": "NPM"
        ]

        var foundTech: [String] = []
        for (keyword, tech) in techKeywords {
            if allText.contains(keyword) && foundTech.count < 2 {
                foundTech.append(tech)
            }
        }

        if !foundTech.isEmpty {
            return "Tech: \(foundTech.joined(separator: ", "))"
        }

        return ""
    }

    private func categorizeObjects(_ objects: [String]) -> [String] {
        let workCategories: [String: [String]] = [
            "code/development": ["programming", "computer", "display", "screen", "monitor", "laptop", "text", "document"],
            "communication": ["communication", "message", "email", "chat", "video", "meeting"],
            "design work": ["design", "graphics", "image", "photo", "art", "creative"],
            "web browsing": ["web", "browser", "internet", "webpage", "site"],
            "documentation": ["document", "paper", "text", "writing", "note"]
        ]

        var foundCategories: [String] = []

        for (category, keywords) in workCategories {
            for object in objects {
                let objectLower = object.lowercased()
                if keywords.contains(where: { objectLower.contains($0) }) {
                    foundCategories.append(category)
                    break
                }
            }
        }

        // Remove duplicates and return unique categories
        return Array(Set(foundCategories))
    }

    private func summarizeText(_ textLines: [String]) -> String {
        let allText = textLines.joined(separator: " ")
        let words = allText.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }

        if words.isEmpty {
            return ""
        }

        // Look for common work-related keywords
        let workKeywords = ["project", "task", "meeting", "code", "review", "development", "design", "api", "database", "client"]
        let foundWorkKeywords = workKeywords.filter { keyword in
            words.contains { $0.lowercased().contains(keyword) }
        }

        if !foundWorkKeywords.isEmpty {
            return "work-related content about \(foundWorkKeywords.joined(separator: ", "))"
        }

        // Generic text summary
        if words.count > 20 {
            return "text content with \(words.count) words"
        } else if words.count > 5 {
            return "text content"
        } else {
            return "minimal text"
        }
    }
}

// MARK: - Helper Functions
private func jsonString<T: Codable>(from object: T) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted

    guard let data = try? encoder.encode(object),
          let string = String(data: data, encoding: .utf8) else {
        return "{\"success\": false, \"error\": \"Failed to encode response\"}"
    }

    return string
}

// MARK: - Main Execution
let analyzer = ScreenshotAnalyzer()
let arguments = CommandLine.arguments

if arguments.count < 2 {
    // Read from stdin for JSON input
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    let input = String(data: inputData, encoding: .utf8) ?? ""

    guard !input.isEmpty,
          let data = input.data(using: .utf8),
          let request = try? JSONDecoder().decode(AnalysisRequest.self, from: data) else {
        let errorResponse = AnalysisResponse(
            success: false,
            requestId: nil,
            description: nil,
            confidence: nil,
            error: "Invalid JSON input. Expected {\"imagePath\": \"path/to/image.png\", \"requestId\": \"optional-id\"}",
            detectedText: nil,
            objects: nil
        )
        print(jsonString(from: errorResponse))
        exit(1)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var finalResult: AnalysisResponse?

    analyzer.analyzeImage(at: request.imagePath) { result in
        finalResult = AnalysisResponse(
            success: result.success,
            requestId: request.requestId,
            description: result.description,
            confidence: result.confidence,
            error: result.error,
            detectedText: result.detectedText,
            objects: result.objects
        )
        semaphore.signal()
    }

    semaphore.wait()
    print(jsonString(from: finalResult!))
} else {
    // Direct command line usage
    let imagePath = arguments[1]
    let semaphore = DispatchSemaphore(value: 0)
    var finalResult: AnalysisResponse?

    analyzer.analyzeImage(at: imagePath) { result in
        finalResult = result
        semaphore.signal()
    }

    semaphore.wait()
    print(jsonString(from: finalResult!))
}
