#!/usr/bin/env swift

import Foundation
import Vision
import AppKit
import NaturalLanguage

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

// Structured extraction data
struct ExtractedText: Codable {
    // Industry-agnostic text categories (matching prompts.json)
    let filenames: [String]      // File names, paths, document names
    let headings: [String]       // Headers, titles, section names
    let bodyText: [String]       // Regular paragraph text, content
    let urls: [String]           // URLs, web addresses, links
    let labels: [String]         // Button text, menu items, tab names, field labels
    let values: [String]         // Numbers, dates, times, measurements, data values
    let notifications: [String]  // Alerts, errors, warnings, status messages
    let identifiers: [String]    // Reference numbers, codes, IDs, tags

    // Legacy fields for backward compatibility
    let code: [String]
    let commands: [String]
    let uiLabels: [String]
    let documentText: [String]
    let errors: [String]
    let projectIdentifiers: [String]
}

struct VisualContext: Codable {
    let application: String
    let applicationMode: String?
    let layout: String?
    let activeTab: String?
    let sidebar: String?
    let visiblePanels: [String]
}

struct FileContext: Codable {
    let filename: String?
    let path: String?
    let language: String?
    let `extension`: String?
}

struct ProjectContext: Codable {
    let projectName: String?
    let directoryStructure: [String]
    let branchName: String?
    let issueReferences: [String]
    let featureName: String?
    let configFiles: [String]
}

struct StructuredExtraction: Codable {
    let extractedText: ExtractedText
    let visualContext: VisualContext
    let fileContext: FileContext?
    let projectContext: ProjectContext
    let detectedTechnologies: [String]
    let detectedActivities: [String]
}

struct AnalysisResponse: Codable {
    let success: Bool
    let requestId: String?
    let description: String?
    let confidence: Float?
    let error: String?
    let detectedText: [String]?
    let objects: [String]?
    let extraction: StructuredExtraction?
}

// MARK: - Screenshot Analyzer
class ScreenshotAnalyzer {
    private var promptConfig: PromptConfig?

    init() {
        loadPromptConfig()
    }

    private func loadPromptConfig() {
        // Try multiple locations for prompts.json
        let possiblePaths = [
            // 1. Same directory as the executable (when running compiled binary)
            URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("prompts.json").path,
            // 2. Parent of build directory (native/screenshot-analyzer/prompts.json)
            URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("prompts.json").path,
            // 3. Source file directory (when running with swift directly)
            URL(fileURLWithPath: #file).deletingLastPathComponent().appendingPathComponent("prompts.json").path,
            // 4. Hardcoded fallback path
            "/Users/benoittanguay/Documents/Anti/TimePortal/native/screenshot-analyzer/prompts.json"
        ]

        for promptPath in possiblePaths {
            if FileManager.default.fileExists(atPath: promptPath) {
                do {
                    let data = try Data(contentsOf: URL(fileURLWithPath: promptPath))
                    promptConfig = try JSONDecoder().decode(PromptConfig.self, from: data)
                    return
                } catch {
                    // Write to stderr to avoid corrupting JSON output on stdout
                    FileHandle.standardError.write("Failed to parse prompt config at \(promptPath): \(error)\n".data(using: .utf8)!)
                }
            }
        }

        // Write to stderr to avoid corrupting JSON output on stdout
        FileHandle.standardError.write("Failed to load prompt config from any location, using defaults\n".data(using: .utf8)!)
        // Use default config as fallback
        promptConfig = createDefaultPromptConfig()
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
                objects: nil,
                extraction: nil
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

        // STAGE 1: Generate structured extraction from detected text and objects
        let extraction = self.generateStructuredExtraction(
            detectedText: detectedText,
            detectedObjects: detectedObjects,
            imagePath: path
        )

        // STAGE 2: Generate on-device AI narrative using Apple Intelligence
        // This uses Apple's NaturalLanguage framework + advanced heuristics
        FileHandle.standardError.write("[DEBUG] STAGE 2: Calling generateOnDeviceAINarrative\n".data(using: .utf8)!)
        var aiDescription = self.generateOnDeviceAINarrative(
            extraction: extraction,
            imagePath: path
        )

        FileHandle.standardError.write("[DEBUG] AI description returned: '\(aiDescription)' (length: \(aiDescription.count))\n".data(using: .utf8)!)

        // Ensure we always have a meaningful description
        // If the AI narrative is empty or too short, create a fallback using app info
        if aiDescription.isEmpty || aiDescription.count < 10 {
            FileHandle.standardError.write("[DEBUG] AI description too short, using fallback\n".data(using: .utf8)!)
            let appName = extraction.visualContext.application
            let windowTitle = extraction.visualContext.activeTab ?? ""
            FileHandle.standardError.write("[DEBUG] Fallback - appName: '\(appName)', windowTitle: '\(windowTitle)'\n".data(using: .utf8)!)
            if !windowTitle.isEmpty && windowTitle != "Unknown" {
                aiDescription = "Viewing \(windowTitle) in \(appName)."
                FileHandle.standardError.write("[DEBUG] Using fallback with window: '\(aiDescription)'\n".data(using: .utf8)!)
            } else {
                aiDescription = "Working in \(appName)."
                FileHandle.standardError.write("[DEBUG] Using fallback without window: '\(aiDescription)'\n".data(using: .utf8)!)
            }
        }

        FileHandle.standardError.write("[DEBUG] Final aiDescription: '\(aiDescription)'\n".data(using: .utf8)!)

        completion(AnalysisResponse(
            success: true,
            requestId: nil,
            description: aiDescription,  // On-device AI-generated narrative (with fallback)
            confidence: confidenceScore > 0 ? confidenceScore : 0.8,
            error: nil,
            detectedText: detectedText.isEmpty ? nil : detectedText,
            objects: detectedObjects.isEmpty ? nil : detectedObjects,
            extraction: extraction
        ))
    }

    // MARK: - Structured Extraction (Step 1)
    private func generateStructuredExtraction(detectedText: [String], detectedObjects: [String], imagePath: String) -> StructuredExtraction {
        let allText = detectedText.joined(separator: " ")
        let allTextLower = allText.lowercased()

        // Extract app info from filename
        let filename = URL(fileURLWithPath: imagePath).lastPathComponent
        let appInfo = extractAppInfoFromFilename(filename)

        // === TEXT EXTRACTION ===
        // New industry-agnostic fields
        var filenames: [String] = []
        var headings: [String] = []         // Headers, titles, section names
        var bodyText: [String] = []         // Regular paragraph text
        var urls: [String] = []
        var labels: [String] = []           // Button text, menu items, field labels
        var values: [String] = []           // Numbers, dates, times, measurements
        var notifications: [String] = []   // Alerts, errors, warnings, status messages
        var identifiers: [String] = []     // Reference numbers, codes, IDs

        // Legacy fields for backward compatibility
        var code: [String] = []  // Structured text that looks like code/syntax
        var commands: [String] = []
        var uiLabels: [String] = []
        var documentText: [String] = []
        var errors: [String] = []  // Error/warning messages
        var projectIdentifiers: [String] = []

        // Common file extensions across all industries
        let fileExtensions = [
            // Documents
            ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt", ".pages",
            // Spreadsheets
            ".xlsx", ".xls", ".csv", ".numbers", ".ods",
            // Presentations
            ".pptx", ".ppt", ".key", ".odp",
            // Images
            ".jpg", ".jpeg", ".png", ".gif", ".svg", ".bmp", ".tiff", ".psd", ".ai", ".sketch", ".fig",
            // Data/Config
            ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".conf",
            // Code (software development)
            ".tsx", ".ts", ".jsx", ".js", ".swift", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".css", ".html",
            // Other
            ".md", ".log", ".sql"
        ]

        for text in detectedText {
            let textLower = text.lowercased()

            // Categorize filenames and paths
            if fileExtensions.contains(where: { text.hasSuffix($0) }) || text.contains("/") || text.contains("\\") {
                filenames.append(text)
            }

            // Categorize structured text (could be code, formulas, technical notation)
            // Look for syntax patterns common in structured content
            if textLower.contains("function") || textLower.contains("const ") || textLower.contains("let ") ||
               textLower.contains("var ") || textLower.contains("import ") || textLower.contains("export ") ||
               textLower.contains("class ") || textLower.contains("interface ") || textLower.contains("type ") ||
               textLower.contains("func ") || textLower.contains("def ") || textLower.contains("async ") ||
               textLower.contains("=sum(") || textLower.contains("=if(") || textLower.contains("=vlookup(") {
                code.append(text)
            }

            // Categorize URLs
            if textLower.contains("http://") || textLower.contains("https://") || textLower.contains("localhost") ||
               textLower.contains("://") || textLower.contains(".com") || textLower.contains(".org") || textLower.contains(".net") {
                urls.append(text)
            }

            // Categorize commands - CLI patterns
            if textLower.starts(with: "$ ") || textLower.starts(with: "> ") ||
               textLower.starts(with: "npm ") || textLower.starts(with: "git ") ||
               textLower.starts(with: "yarn ") || textLower.starts(with: "docker ") ||
               textLower.starts(with: "cargo ") || textLower.starts(with: "python ") {
                commands.append(text)
            }

            // Categorize errors and warnings (universal)
            if textLower.contains("error") || textLower.contains("exception") || textLower.contains("failed") ||
               textLower.contains("warning") || textLower.contains("alert") || textLower.contains("cannot") ||
               textLower.contains("invalid") || textLower.contains("denied") {
                errors.append(text)
            }

            // Categorize project identifiers - strict pattern matching for issue tracking
            // Matches patterns like: PROJ-123, ABC-456, etc.
            if text.contains("-") && text.count >= 5 {
                let pattern = "\\b([A-Z]{2,10})-([0-9]+)\\b"
                if let regex = try? NSRegularExpression(pattern: pattern) {
                    let range = NSRange(text.startIndex..., in: text)
                    if regex.firstMatch(in: text, range: range) != nil {
                        projectIdentifiers.append(text)
                    }
                }
            }

            // === NEW INDUSTRY-AGNOSTIC FIELD EXTRACTION ===

            // Categorize headings - short, prominent text (often ALL CAPS or Title Case)
            // These are typically headers, titles, or section names
            let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmedText.count >= 3 && trimmedText.count <= 50 {
                // Check for ALL CAPS text (common for headings)
                let uppercased = trimmedText.uppercased()
                if trimmedText == uppercased && trimmedText.contains(" ") == false && trimmedText.first?.isLetter == true {
                    headings.append(trimmedText)
                }
                // Check for Title Case patterns (word starts with caps, 2-5 words)
                let words = trimmedText.components(separatedBy: " ")
                if words.count >= 1 && words.count <= 5 {
                    let titleCaseCount = words.filter { word in
                        guard let first = word.first else { return false }
                        return first.isUppercase
                    }.count
                    if titleCaseCount == words.count && words[0].count > 2 {
                        headings.append(trimmedText)
                    }
                }
            }

            // Categorize body text - longer text strings that look like content
            if trimmedText.count > 30 && !textLower.contains("http") && !textLower.contains("://") {
                // Exclude text that looks like code or commands
                let codeIndicators = ["function", "const ", "let ", "var ", "import ", "export ", "class ", "def "]
                let looksLikeCode = codeIndicators.contains(where: { textLower.contains($0) })
                if !looksLikeCode && !textLower.starts(with: "$ ") && !textLower.starts(with: "> ") {
                    bodyText.append(trimmedText)
                }
            }

            // Categorize labels - short text that looks like UI elements
            // Menu items, button text, field labels typically < 25 chars
            if trimmedText.count >= 2 && trimmedText.count <= 25 && !filenames.contains(trimmedText) {
                // Common UI label patterns
                let labelKeywords = ["save", "cancel", "close", "open", "edit", "delete", "add", "remove", "new", "create",
                                    "submit", "send", "ok", "yes", "no", "apply", "reset", "search", "filter", "sort",
                                    "settings", "preferences", "options", "help", "about", "menu", "file", "view", "tools",
                                    "window", "quit", "exit", "back", "forward", "next", "previous", "home", "end"]
                if labelKeywords.contains(where: { textLower == $0 || textLower.contains($0) }) {
                    labels.append(trimmedText)
                }
            }

            // Categorize values - numbers, dates, times, measurements
            // Detect numeric patterns, date/time formats, currency, percentages
            let valuePatterns = [
                "\\$[0-9,]+\\.?[0-9]*",           // Currency: $1,234.56
                "[0-9]+\\.[0-9]+%?",               // Decimal numbers with optional %
                "[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?", // Time: 12:34 or 12:34:56
                "[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}", // Date: 12/31/2024
                "[0-9]{4}-[0-9]{2}-[0-9]{2}",      // ISO date: 2024-12-31
                "[0-9]+\\s*(KB|MB|GB|TB|px|em|rem|pt|%)", // Sizes and measurements
                "\\b[0-9]{1,3}(,[0-9]{3})+\\b"    // Large numbers with commas
            ]
            for pattern in valuePatterns {
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let range = NSRange(text.startIndex..., in: text)
                    if regex.firstMatch(in: text, range: range) != nil {
                        values.append(trimmedText)
                        break
                    }
                }
            }

            // Categorize notifications - alerts, warnings, status messages
            // Already captured in errors, but expand to include success/info messages
            let notificationKeywords = ["success", "complete", "done", "saved", "updated", "loading", "processing",
                                        "please wait", "in progress", "connecting", "syncing", "ready", "offline",
                                        "online", "connected", "disconnected", "uploading", "downloading"]
            if notificationKeywords.contains(where: { textLower.contains($0) }) || errors.contains(trimmedText) {
                notifications.append(trimmedText)
            }

            // Categorize identifiers - reference numbers, codes, IDs, tags
            // Alphanumeric patterns that look like IDs or reference numbers
            let identifierPatterns = [
                "\\b[A-Z]{2,5}-[0-9]{1,6}\\b",     // JIRA-style: ABC-123
                "#[0-9]+\\b",                       // Issue/PR numbers: #123
                "\\b[A-Za-z0-9]{8,12}\\b",         // Short hashes/IDs: abc123def
                "\\b(ID|REF|ORDER|TICKET|CASE)[:\\s]?[A-Za-z0-9]+\\b"  // Labeled IDs
            ]
            for pattern in identifierPatterns {
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let range = NSRange(text.startIndex..., in: text)
                    if regex.firstMatch(in: text, range: range) != nil {
                        // Apply false positive filter
                        let prefix = trimmedText.components(separatedBy: "-").first?.uppercased() ?? ""
                        let commonFalsePositives = ["UTF", "ISO", "HTTP", "HTTPS", "RGB", "RGBA", "API", "URL", "URI", "SQL", "HTML", "CSS", "JSON", "XML", "PDF", "PNG", "JPG", "GIF", "MP3", "MP4", "H264"]
                        if !commonFalsePositives.contains(prefix) {
                            identifiers.append(trimmedText)
                        }
                        break
                    }
                }
            }
        }

        // === VISUAL CONTEXT ===
        let application = appInfo.appName ?? "Unknown"
        var applicationMode: String? = nil
        var layout: String? = nil
        var activeTab: String? = nil
        var sidebar: String? = nil
        var visiblePanels: [String] = []

        // Detect application mode from text content
        if allTextLower.contains("debug") || allTextLower.contains("debugger") {
            applicationMode = "Debug mode"
        } else if allTextLower.contains("terminal") || allTextLower.contains("console") {
            applicationMode = "Terminal/Console"
        } else if allTextLower.contains("git") {
            applicationMode = "Version control"
        }

        // Detect panels from common UI elements
        if allTextLower.contains("problems") {
            visiblePanels.append("Problems panel")
        }
        if allTextLower.contains("output") {
            visiblePanels.append("Output panel")
        }
        if allTextLower.contains("terminal") {
            visiblePanels.append("Terminal panel")
        }

        let visualContext = VisualContext(
            application: application,
            applicationMode: applicationMode,
            layout: layout,
            activeTab: appInfo.windowTitle,
            sidebar: sidebar,
            visiblePanels: visiblePanels
        )

        // === FILE CONTEXT ===
        var fileContext: FileContext? = nil
        if let windowTitle = appInfo.windowTitle, !windowTitle.isEmpty {
            let ext = (windowTitle as NSString).pathExtension
            var language: String? = nil

            // Map extensions to languages
            switch ext.lowercased() {
            case "tsx": language = "TypeScript React"
            case "ts": language = "TypeScript"
            case "jsx": language = "JavaScript React"
            case "js": language = "JavaScript"
            case "swift": language = "Swift"
            case "py": language = "Python"
            case "java": language = "Java"
            case "go": language = "Go"
            case "rs": language = "Rust"
            default: break
            }

            fileContext = FileContext(
                filename: windowTitle,
                path: nil,
                language: language,
                `extension`: ext.isEmpty ? nil : ext
            )
        }

        // === PROJECT CONTEXT ===
        var directoryStructure: [String] = []
        var issueRefs: [String] = []
        var configFiles: [String] = []

        // Extract directory paths from filenames
        for filename in filenames {
            if filename.contains("/") {
                let parts = filename.components(separatedBy: "/")
                if parts.count > 1 {
                    directoryStructure.append(contentsOf: parts.dropLast())
                }
            }
        }
        directoryStructure = Array(Set(directoryStructure)).sorted()

        // Extract issue references (JIRA-style)
        // Use strict pattern: 2-10 uppercase letters, hyphen, 1+ digits, with word boundaries
        for text in detectedText {
            let pattern = "\\b([A-Z]{2,10})-([0-9]+)\\b"
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(text.startIndex..., in: text)
                let matches = regex.matches(in: text, range: range)
                for match in matches {
                    if let range = Range(match.range, in: text) {
                        let issueKey = String(text[range])
                        // Filter out common false positives like "UTF-8", "ISO-9001", etc.
                        let prefix = issueKey.components(separatedBy: "-")[0]
                        let commonFalsePositives = ["UTF", "ISO", "HTTP", "HTTPS", "RGB", "RGBA", "API", "URL", "URI", "SQL", "HTML", "CSS", "JSON", "XML", "PDF", "PNG", "JPG", "GIF", "MP3", "MP4", "H264"]
                        if !commonFalsePositives.contains(prefix) {
                            issueRefs.append(issueKey)
                        }
                    }
                }
            }
        }

        // Detect config files
        let commonConfigFiles = ["package.json", "tsconfig.json", "Cargo.toml", "Podfile", "requirements.txt", "docker-compose.yml"]
        for configFile in commonConfigFiles {
            if allTextLower.contains(configFile.lowercased()) {
                configFiles.append(configFile)
            }
        }

        // Try to extract project name from paths or identifiers
        var projectName: String? = nil

        // Look for "timeportal", "TimePortal" or other project-specific names
        // Check filenames first as they often contain full paths
        for filename in filenames {
            let filenameLower = filename.lowercased()
            if filenameLower.contains("timeportal") {
                projectName = "TimePortal"
                break
            }
            // Look for other common project name patterns in paths
            // Only consider paths with slashes (actual file paths, not commands)
            if filename.contains("/") || filename.contains("\\") {
                let components = filename.components(separatedBy: "/")
                // Skip common directory names and look for project root
                let skipDirs = ["src", "lib", "components", "utils", "node_modules", "build", "dist", "dist-electron", "tests", "test", "public", "assets", "styles", "electron", "native", "landing", "bin", "obj", "target", "out"]
                for component in components {
                    let componentLower = component.lowercased()
                    // Must be a reasonable length, not in skip list, and not a file with extension
                    if !skipDirs.contains(componentLower) &&
                       component.count > 3 &&
                       component.count < 30 &&
                       !component.contains(".") {
                        // Capitalize first letter
                        projectName = component.prefix(1).uppercased() + component.dropFirst()
                        break
                    }
                }
                if projectName != nil { break }
            }
        }

        // Fallback to directory structure (only meaningful directories)
        if projectName == nil {
            let skipDirs = ["src", "lib", "components", "utils", "node_modules", "build", "dist", "dist-electron", "tests", "test", "public", "assets", "styles", "electron", "native"]
            for path in directoryStructure {
                if !skipDirs.contains(path.lowercased()) && path.count > 2 && path.count < 30 {
                    projectName = path
                    break
                }
            }
        }

        let projectContext = ProjectContext(
            projectName: projectName,
            directoryStructure: directoryStructure,
            branchName: nil,
            issueReferences: issueRefs,
            featureName: nil,
            configFiles: configFiles
        )

        // === DETECT TOOLS/APPLICATIONS (Industry-agnostic) ===
        var technologies: [String] = []
        let toolKeywords: [(String, [String])] = [
            // Software Development
            ("React", ["react", "jsx", "tsx", "usestate", "useeffect"]),
            ("TypeScript", ["typescript", "interface", ".ts", ".tsx"]),
            ("JavaScript", ["javascript", ".js", "node.js"]),
            ("Python", ["python", ".py", "def ", "import "]),
            ("Swift", ["swift", ".swift", "import foundation"]),
            ("Java", ["java", ".java", "public class"]),
            // Office/Productivity
            ("Excel", ["excel", ".xlsx", ".xls", "spreadsheet"]),
            ("Word", ["microsoft word", ".docx", ".doc"]),
            ("PowerPoint", ["powerpoint", ".pptx", ".ppt"]),
            ("Google Docs", ["google docs", "docs.google.com"]),
            ("Google Sheets", ["google sheets", "sheets.google.com"]),
            // Design
            ("Photoshop", ["photoshop", ".psd"]),
            ("Illustrator", ["illustrator", ".ai"]),
            ("Figma", ["figma", "figma.com"]),
            ("Sketch", ["sketch", ".sketch"]),
            // Communication
            ("Slack", ["slack", "slack.com"]),
            ("Teams", ["microsoft teams", "teams.microsoft.com"]),
            ("Zoom", ["zoom", "zoom.us"]),
            // Project Management
            ("Jira", ["jira", "atlassian"]),
            ("Asana", ["asana", "asana.com"]),
            ("Trello", ["trello", "trello.com"]),
            // Development Tools
            ("Git", ["git ", "github", "gitlab"]),
            ("Docker", ["docker", "container"]),
            ("VSCode", ["visual studio code", "vscode"]),
            ("Xcode", ["xcode", ".xcodeproj"])
        ]

        for (tool, keywords) in toolKeywords {
            if keywords.contains(where: { allTextLower.contains($0) }) {
                technologies.append(tool)
            }
        }

        // === DETECT CONTENT TYPES (Not activities - what's being viewed) ===
        var activities: [String] = []
        if !code.isEmpty {
            activities.append("Structured text visible")  // Could be code, formulas, etc.
        }
        if !errors.isEmpty {
            activities.append("Error/warning messages present")
        }
        if !urls.isEmpty {
            activities.append("Web content")
        }
        if allTextLower.contains("edit") || allTextLower.contains("type") {
            activities.append("Text editing")
        }
        if !commands.isEmpty {
            activities.append("Command-line interface")
        }

        // Deduplicate arrays before creating ExtractedText
        let extractedText = ExtractedText(
            filenames: Array(Set(filenames)),
            headings: Array(Set(headings)),
            bodyText: Array(Set(bodyText)),
            urls: Array(Set(urls)),
            labels: Array(Set(labels)),
            values: Array(Set(values)),
            notifications: Array(Set(notifications)),
            identifiers: Array(Set(identifiers)),
            // Legacy fields for backward compatibility
            code: code,
            commands: commands,
            uiLabels: uiLabels,
            documentText: documentText,
            errors: errors,
            projectIdentifiers: projectIdentifiers
        )

        return StructuredExtraction(
            extractedText: extractedText,
            visualContext: visualContext,
            fileContext: fileContext,
            projectContext: projectContext,
            detectedTechnologies: technologies,
            detectedActivities: activities
        )
    }

    // MARK: - On-Device AI Narrative Generation (Stage 2)
    /**
     * Generate an intelligent, contextual narrative using on-device AI techniques.
     * This combines Apple's NaturalLanguage framework with sophisticated heuristics
     * to create narrative descriptions comparable to external LLMs, but entirely on-device.
     *
     * Architecture:
     * 1. Semantic Analysis - Use NaturalLanguage to understand content relationships
     * 2. Context Synthesis - Build narrative structure from extracted elements
     * 3. Natural Language Generation - Create coherent, varied descriptions
     */
    private func generateOnDeviceAINarrative(extraction: StructuredExtraction, imagePath: String) -> String {
        // DEBUG: Log extraction data
        FileHandle.standardError.write("[DEBUG] Starting AI narrative generation\n".data(using: .utf8)!)
        FileHandle.standardError.write("[DEBUG] App: \(extraction.visualContext.application)\n".data(using: .utf8)!)
        FileHandle.standardError.write("[DEBUG] Window: \(extraction.visualContext.activeTab ?? "nil")\n".data(using: .utf8)!)

        // Analyze the semantic content using Apple's NaturalLanguage framework
        let semanticContext = analyzeSemanticContext(extraction: extraction)

        FileHandle.standardError.write("[DEBUG] Intent: \(semanticContext.primaryIntent)\n".data(using: .utf8)!)
        FileHandle.standardError.write("[DEBUG] Domain: \(semanticContext.contentDomain)\n".data(using: .utf8)!)

        // Build narrative components
        var narrative: [String] = []

        // PART 1: Primary Activity Statement
        let activityStatement = generateActivityStatement(
            extraction: extraction,
            semanticContext: semanticContext
        )
        FileHandle.standardError.write("[DEBUG] Activity statement: '\(activityStatement)'\n".data(using: .utf8)!)
        narrative.append(activityStatement)

        // PART 2: Context and Details
        if let contextStatement = generateContextStatement(
            extraction: extraction,
            semanticContext: semanticContext
        ) {
            FileHandle.standardError.write("[DEBUG] Context statement: '\(contextStatement)'\n".data(using: .utf8)!)
            narrative.append(contextStatement)
        }

        // PART 3: Technical Stack (when relevant)
        if let techStatement = generateTechnologyStatement(
            extraction: extraction,
            semanticContext: semanticContext
        ) {
            FileHandle.standardError.write("[DEBUG] Tech statement: '\(techStatement)'\n".data(using: .utf8)!)
            narrative.append(techStatement)
        }

        let finalNarrative = narrative.joined(separator: " ")
        FileHandle.standardError.write("[DEBUG] Final narrative (\(finalNarrative.count) chars): '\(finalNarrative)'\n".data(using: .utf8)!)

        return finalNarrative
    }

    /**
     * Semantic Context - Uses Apple's NaturalLanguage to understand relationships
     */
    private struct SemanticContext {
        let primaryIntent: WorkIntent
        let complexity: ComplexityLevel
        let contentDomain: ContentDomain
        let keyEntities: [String]
        let sentimentScore: Double
    }

    private enum WorkIntent {
        case editing         // Creating or modifying content
        case troubleshooting // Addressing errors/issues
        case reviewing       // Reading/analyzing content
        case configuring     // Setting up or adjusting settings
        case communicating   // Messaging or email
        case presenting      // Viewing or creating presentations
        case analyzing       // Working with data/analytics
        case unknown
    }

    private enum ComplexityLevel {
        case simple      // Single file, clear focus
        case moderate    // Multiple files, clear task
        case complex     // Many files, complex task
    }

    private enum ContentDomain {
        case textDocument    // Word processors, documents
        case spreadsheet     // Excel, data tables
        case presentation    // Slides, presentations
        case communication   // Email, chat, messaging
        case webBrowser      // Web browsing
        case graphics        // Image/design work
        case codeEditor      // Software development
        case general
    }

    /**
     * Analyze semantic context using NaturalLanguage framework
     */
    private func analyzeSemanticContext(extraction: StructuredExtraction) -> SemanticContext {
        // Combine all text for semantic analysis
        let allText = [
            extraction.extractedText.code,
            extraction.extractedText.filenames,
            extraction.extractedText.commands,
            extraction.extractedText.errors,
            extraction.extractedText.documentText
        ].flatMap { $0 }.joined(separator: " ")

        // Use NaturalLanguage for sentiment analysis
        let tagger = NLTagger(tagSchemes: [.sentimentScore])
        tagger.string = allText
        let (sentiment, _) = tagger.tag(at: allText.startIndex, unit: .paragraph, scheme: .sentimentScore)
        let sentimentScore = Double(sentiment?.rawValue ?? "0") ?? 0.0

        // Determine primary work intent
        let intent = determineWorkIntent(extraction: extraction)

        // Assess complexity
        let complexity = assessComplexity(extraction: extraction)

        // Identify content domain
        let domain = identifyContentDomain(extraction: extraction)

        // Extract key entities using Named Entity Recognition
        let entities = extractKeyEntities(from: allText)

        return SemanticContext(
            primaryIntent: intent,
            complexity: complexity,
            contentDomain: domain,
            keyEntities: entities,
            sentimentScore: sentimentScore
        )
    }

    /**
     * Determine the primary work intent from activities and content
     */
    private func determineWorkIntent(extraction: StructuredExtraction) -> WorkIntent {
        let hasErrors = !extraction.extractedText.errors.isEmpty
        let hasStructuredText = !extraction.extractedText.code.isEmpty
        let allText = extraction.extractedText.documentText.joined(separator: " ").lowercased()

        // Check for communication patterns
        let hasCommunication = extraction.visualContext.application.lowercased().contains("slack") ||
                              extraction.visualContext.application.lowercased().contains("teams") ||
                              extraction.visualContext.application.lowercased().contains("mail") ||
                              allText.contains("sent:") || allText.contains("from:") || allText.contains("to:")

        // Check for presentation mode
        let hasPresentation = extraction.visualContext.application.lowercased().contains("powerpoint") ||
                             extraction.visualContext.application.lowercased().contains("keynote") ||
                             allText.contains("slide")

        // Check for data analysis
        let hasDataAnalysis = extraction.visualContext.application.lowercased().contains("excel") ||
                             extraction.visualContext.application.lowercased().contains("sheets") ||
                             allText.contains("chart") || allText.contains("graph")

        // Determine intent based on observable patterns
        if hasErrors {
            return .troubleshooting
        } else if hasCommunication {
            return .communicating
        } else if hasPresentation {
            return .presenting
        } else if hasDataAnalysis {
            return .analyzing
        } else if hasStructuredText || allText.contains("edit") {
            return .editing
        } else if allText.contains("settings") || allText.contains("preferences") || allText.contains("configure") {
            return .configuring
        } else if allText.count > 100 {
            return .reviewing  // Lots of text visible, likely reading
        } else {
            return .unknown
        }
    }

    /**
     * Assess the complexity of the work session
     */
    private func assessComplexity(extraction: StructuredExtraction) -> ComplexityLevel {
        let fileCount = extraction.extractedText.filenames.count
        let techCount = extraction.detectedTechnologies.count
        let hasMultipleContexts = extraction.visualContext.visiblePanels.count > 2

        if fileCount > 5 || techCount > 3 || hasMultipleContexts {
            return .complex
        } else if fileCount > 2 || techCount > 1 {
            return .moderate
        } else {
            return .simple
        }
    }

    /**
     * Identify the primary content domain
     */
    private func identifyContentDomain(extraction: StructuredExtraction) -> ContentDomain {
        let appName = extraction.visualContext.application.lowercased()
        let techs = extraction.detectedTechnologies.map { $0.lowercased() }

        // Check by application type first
        if appName.contains("word") || appName.contains("pages") || techs.contains("word") {
            return .textDocument
        } else if appName.contains("excel") || appName.contains("sheets") || appName.contains("numbers") || techs.contains("excel") {
            return .spreadsheet
        } else if appName.contains("powerpoint") || appName.contains("keynote") || techs.contains("powerpoint") {
            return .presentation
        } else if appName.contains("slack") || appName.contains("teams") || appName.contains("mail") || appName.contains("outlook") || techs.contains("slack") {
            return .communication
        } else if appName.contains("safari") || appName.contains("chrome") || appName.contains("firefox") || appName.contains("browser") {
            return .webBrowser
        } else if appName.contains("photoshop") || appName.contains("illustrator") || appName.contains("figma") || appName.contains("sketch") || techs.contains("photoshop") || techs.contains("figma") {
            return .graphics
        } else if appName.contains("vscode") || appName.contains("xcode") || appName.contains("cursor") || appName.contains("atom") ||
                  techs.contains("react") || techs.contains("typescript") || techs.contains("python") {
            return .codeEditor
        } else {
            return .general
        }
    }

    /**
     * Extract key named entities using NaturalLanguage
     */
    private func extractKeyEntities(from text: String) -> [String] {
        guard !text.isEmpty else { return [] }

        let tagger = NLTagger(tagSchemes: [.nameType])
        tagger.string = text

        var entities: [String] = []
        let options: NLTagger.Options = [.omitWhitespace, .omitPunctuation, .joinNames]

        tagger.enumerateTags(in: text.startIndex..<text.endIndex, unit: .word, scheme: .nameType, options: options) { tag, tokenRange in
            if let tag = tag, tag == .organizationName || tag == .placeName {
                let entity = String(text[tokenRange])
                entities.append(entity)
            }
            return true
        }

        return Array(Set(entities)).prefix(5).map { String($0) }
    }

    /**
     * Generate the primary activity statement (first sentence)
     * Always includes window title for meaningful descriptions
     */
    private func generateActivityStatement(extraction: StructuredExtraction, semanticContext: SemanticContext) -> String {
        let intent = semanticContext.primaryIntent
        let appName = extraction.visualContext.application
        let windowTitle = extraction.visualContext.activeTab

        // Always try to include the window title for context
        // This is the most reliable source of what the user is viewing
        if let title = windowTitle, !title.isEmpty && title != "Unknown" && title != appName {
            let cleanTitle = cleanupFilename(title)
            if !cleanTitle.isEmpty && cleanTitle.count > 1 {
                // Generate description with window title
                let verb: String
                switch intent {
                case .editing:
                    verb = "Editing"
                case .troubleshooting:
                    verb = "Troubleshooting"
                case .reviewing:
                    verb = "Viewing"
                case .configuring:
                    verb = "Configuring"
                case .communicating:
                    verb = "Reading"
                case .presenting:
                    verb = "Presenting"
                case .analyzing:
                    verb = "Analyzing"
                case .unknown:
                    verb = "Viewing"
                }
                return "\(verb) \(cleanTitle) in \(appName)."
            }
        }

        // Fallback: no window title available, use generic description
        let activityPhrase: String
        switch intent {
        case .editing:
            activityPhrase = "Working in \(appName)"
        case .troubleshooting:
            let errorCount = extraction.extractedText.errors.count
            activityPhrase = errorCount > 1 ? "Addressing multiple errors in \(appName)" : "Addressing an error in \(appName)"
        case .reviewing:
            activityPhrase = "Reviewing content in \(appName)"
        case .configuring:
            activityPhrase = "Configuring settings in \(appName)"
        case .communicating:
            activityPhrase = "Using \(appName) for communication"
        case .presenting:
            activityPhrase = "Working on a presentation in \(appName)"
        case .analyzing:
            activityPhrase = "Analyzing data in \(appName)"
        case .unknown:
            activityPhrase = "Using \(appName)"
        }

        return "\(activityPhrase)."
    }

    /**
     * Generate contextual details (second sentence) - Stage 2 interpretation
     * This interprets the extracted visual elements into meaningful context
     */
    private func generateContextStatement(extraction: StructuredExtraction, semanticContext: SemanticContext) -> String? {
        var details: [String] = []

        // INTERPRET HEADINGS - These tell us what the user is looking at
        if !extraction.extractedText.headings.isEmpty {
            let topHeadings = extraction.extractedText.headings.prefix(2)
            let cleanHeadings = topHeadings.compactMap { heading -> String? in
                let cleaned = heading.trimmingCharacters(in: .whitespacesAndNewlines)
                return cleaned.count > 2 && cleaned.count < 50 ? cleaned : nil
            }
            if !cleanHeadings.isEmpty {
                details.append("viewing '\(cleanHeadings.joined(separator: "' and '"))'")
            }
        }

        // INTERPRET BODY TEXT - Describe what content is visible
        if !extraction.extractedText.bodyText.isEmpty {
            let bodyCount = extraction.extractedText.bodyText.count
            if bodyCount > 10 {
                details.append("multiple paragraphs of text visible")
            } else if bodyCount > 3 {
                details.append("text content visible")
            }
        }

        // INTERPRET LABELS/NAVIGATION - What UI elements are visible
        if !extraction.extractedText.labels.isEmpty {
            let labelCount = extraction.extractedText.labels.count
            if labelCount > 5 {
                details.append("multiple UI elements and options")
            }
        }

        // INTERPRET VALUES - Statistics, dates, counts
        if !extraction.extractedText.values.isEmpty {
            let hasNumbers = extraction.extractedText.values.contains { $0.contains(where: { $0.isNumber }) }
            if hasNumbers {
                details.append("data and metrics displayed")
            }
        }

        // INTERPRET NOTIFICATIONS/ERRORS
        if !extraction.extractedText.notifications.isEmpty || !extraction.extractedText.errors.isEmpty {
            let errorCount = extraction.extractedText.errors.count
            let notifCount = extraction.extractedText.notifications.count
            if errorCount > 0 {
                let errorTypes = categorizeErrors(extraction.extractedText.errors)
                if !errorTypes.isEmpty {
                    details.append("\(errorTypes.joined(separator: " and ")) shown")
                }
            } else if notifCount > 0 {
                details.append("notifications present")
            }
        }

        // INTERPRET FILENAMES - What files are being worked on
        if !extraction.extractedText.filenames.isEmpty {
            let fileCount = extraction.extractedText.filenames.count
            if fileCount > 3 {
                details.append("\(fileCount) files referenced")
            } else if fileCount > 0 {
                let files = extraction.extractedText.filenames.prefix(2).joined(separator: ", ")
                details.append("working with \(files)")
            }
        }

        // INTERPRET IDENTIFIERS - Issue numbers, ticket IDs, etc.
        if !extraction.extractedText.identifiers.isEmpty {
            let ids = extraction.extractedText.identifiers.prefix(2)
            let jiraIds = ids.filter { $0.contains("-") && $0.count < 15 }
            if !jiraIds.isEmpty {
                details.append("referencing \(jiraIds.joined(separator: ", "))")
            }
        }

        // Add visible UI panels for context
        if !extraction.visualContext.visiblePanels.isEmpty {
            let panels = extraction.visualContext.visiblePanels.prefix(2).joined(separator: " and ")
            details.append("\(panels) open")
        }

        // Limit to 3 most relevant details
        let topDetails = Array(details.prefix(3))
        return topDetails.isEmpty ? nil : "The screen shows \(topDetails.joined(separator: ", "))."
    }

    /**
     * Generate tools/applications statement (third sentence) - optional
     */
    private func generateTechnologyStatement(extraction: StructuredExtraction, semanticContext: SemanticContext) -> String? {
        let tools = extraction.detectedTechnologies
        guard tools.count > 0 && tools.count <= 4 else { return nil }

        // Only mention tools if they add meaningful context beyond the app name
        let appName = extraction.visualContext.application.lowercased()
        let relevantTools = tools.filter { !appName.contains($0.lowercased()) }

        guard !relevantTools.isEmpty else { return nil }

        if relevantTools.count == 1 {
            return "Working with \(relevantTools[0])."
        } else if relevantTools.count <= 3 {
            return "Tools visible: \(relevantTools.joined(separator: ", "))."
        } else {
            return nil  // Too many tools, skip
        }
    }

    /**
     * Categorize errors into meaningful types
     */
    private func categorizeErrors(_ errors: [String]) -> [String] {
        var types = Set<String>()

        for error in errors {
            let lower = error.lowercased()

            // Generic error categories that apply across industries
            if lower.contains("syntax") || lower.contains("format") {
                types.insert("format errors")
            }
            if lower.contains("permission") || lower.contains("access") || lower.contains("denied") {
                types.insert("access errors")
            }
            if lower.contains("network") || lower.contains("connection") || lower.contains("timeout") {
                types.insert("connection issues")
            }
            if lower.contains("invalid") || lower.contains("incorrect") {
                types.insert("validation errors")
            }
            if lower.contains("failed") || lower.contains("error") || lower.contains("exception") {
                types.insert("error messages")
            }
            if lower.contains("warning") {
                types.insert("warnings")
            }
        }

        return Array(types).prefix(2).map { String($0) }
    }

    /**
     * Analyze code features being worked on
     */
    private func analyzeCodeFeatures(_ code: [String]) -> [String] {
        var features = Set<String>()

        for snippet in code.prefix(10) {
            let lower = snippet.lowercased()
            if lower.contains("async") || lower.contains("await") {
                features.insert("asynchronous logic")
            }
            if lower.contains("interface") || lower.contains("type ") {
                features.insert("type definitions")
            }
            if lower.contains("component") || lower.contains("render") {
                features.insert("UI components")
            }
            if lower.contains("api") || lower.contains("fetch") || lower.contains("http") {
                features.insert("API integration")
            }
            if lower.contains("test") || lower.contains("expect") {
                features.insert("test cases")
            }
            if lower.contains("hook") || lower.contains("useeffect") || lower.contains("usestate") {
                features.insert("React hooks")
            }
        }

        return Array(features).prefix(3).map { String($0) }
    }

    // MARK: - Industry-Agnostic Narrative Generation
    // Generates objective descriptions of what is visible on screen
    // WITHOUT assuming industry, profession, or intent
    private func generateNarrativeFromExtraction(extraction: StructuredExtraction, imagePath: String) -> String {
        var sentences: [String] = []

        // Sentence 1: Application and content type
        let appName = extraction.visualContext.application
        var firstSentence = "Using \(appName)"

        // Determine content type from visible elements
        let contentType = determineContentType(extraction: extraction)
        if !contentType.isEmpty {
            firstSentence += " with \(contentType)"
        }

        // Add window/document title if available
        if let fileContext = extraction.fileContext, let filename = fileContext.filename {
            let cleanName = cleanupFilename(filename)
            if !cleanName.isEmpty && cleanName.count > 2 {
                firstSentence += " — '\(cleanName)'"
            }
        }
        firstSentence += "."
        sentences.append(firstSentence)

        // Sentence 2: Describe what is visible on screen (objective)
        var visibleElements: [String] = []

        // Visible panels/UI elements
        let panels = extraction.visualContext.visiblePanels
        if !panels.isEmpty {
            visibleElements.append("visible panels include \(panels.prefix(3).joined(separator: ", "))")
        }

        // Application mode
        if let mode = extraction.visualContext.applicationMode, !mode.isEmpty {
            visibleElements.append("currently in \(mode.lowercased())")
        }

        // Count of visible text elements
        let textCount = extraction.extractedText.filenames.count +
                        extraction.extractedText.headings.count +
                        extraction.extractedText.bodyText.count
        if textCount > 5 {
            visibleElements.append("\(textCount) text elements visible")
        }

        // Headings visible
        let headings = extraction.extractedText.headings
        if !headings.isEmpty {
            let topHeadings = headings.prefix(2).map { "'\($0)'" }.joined(separator: ", ")
            visibleElements.append("headings: \(topHeadings)")
        }

        // Notifications/status messages
        let notifications = extraction.extractedText.notifications
        if !notifications.isEmpty {
            visibleElements.append("\(notifications.count) notification(s) displayed")
        }

        if !visibleElements.isEmpty {
            let secondSentence = "The screen shows " + visibleElements.prefix(3).joined(separator: "; ") + "."
            sentences.append(secondSentence)
        }

        // Sentence 3: Specific content details (if relevant)
        var contentDetails: [String] = []

        // URLs visible
        if !extraction.extractedText.urls.isEmpty {
            contentDetails.append("\(extraction.extractedText.urls.count) web address(es)")
        }

        // Values/data visible
        let values = extraction.extractedText.values
        if !values.isEmpty {
            contentDetails.append("data values visible")
        }

        // Identifiers/reference numbers
        let identifiers = extraction.extractedText.identifiers
        if !identifiers.isEmpty {
            contentDetails.append("\(identifiers.count) identifier(s) or reference number(s)")
        }

        if !contentDetails.isEmpty {
            let thirdSentence = "Content includes " + contentDetails.joined(separator: ", ") + "."
            sentences.append(thirdSentence)
        }

        return sentences.prefix(3).joined(separator: " ")
    }

    // Determine content type objectively based on visual elements
    private func determineContentType(extraction: StructuredExtraction) -> String {
        let text = extraction.extractedText
        let visual = extraction.visualContext

        // Check for specific content patterns
        if !text.values.isEmpty && text.values.count > 3 {
            return "numerical data"
        }

        if !text.urls.isEmpty && text.urls.count > 2 {
            return "web content"
        }

        if visual.application.lowercased().contains("mail") ||
           visual.application.lowercased().contains("outlook") ||
           visual.application.lowercased().contains("gmail") {
            return "email content"
        }

        if visual.application.lowercased().contains("slack") ||
           visual.application.lowercased().contains("teams") ||
           visual.application.lowercased().contains("discord") {
            return "messaging content"
        }

        if visual.application.lowercased().contains("excel") ||
           visual.application.lowercased().contains("sheets") ||
           visual.application.lowercased().contains("numbers") {
            return "spreadsheet data"
        }

        if visual.application.lowercased().contains("word") ||
           visual.application.lowercased().contains("docs") ||
           visual.application.lowercased().contains("pages") {
            return "document content"
        }

        if visual.application.lowercased().contains("chrome") ||
           visual.application.lowercased().contains("safari") ||
           visual.application.lowercased().contains("firefox") ||
           visual.application.lowercased().contains("edge") {
            return "web browser content"
        }

        if !text.bodyText.isEmpty && text.bodyText.count > 5 {
            return "text content"
        }

        if !text.labels.isEmpty && text.labels.count > 3 {
            return "interface elements"
        }

        return "content"
    }

    // Helper function to clean up filenames
    private func cleanupFilename(_ filename: String) -> String {
        var cleaned = filename

        // Remove git status indicators (U, M, A, D, etc.) that appear as suffixes
        let gitStatusPattern = "\\s+[UMADRC]$"
        if let regex = try? NSRegularExpression(pattern: gitStatusPattern) {
            let range = NSRange(cleaned.startIndex..., in: cleaned)
            cleaned = regex.stringByReplacingMatches(in: cleaned, range: range, withTemplate: "")
        }

        // Remove ellipsis and truncation artifacts
        cleaned = cleaned.replacingOccurrences(of: "...", with: "")
        cleaned = cleaned.replacingOccurrences(of: "…", with: "")

        // Remove trailing whitespace
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)

        // If the filename looks truncated (ends with incomplete path), try to extract meaningful part
        if cleaned.hasSuffix("/") || cleaned.hasSuffix("\\") {
            cleaned = String(cleaned.dropLast())
        }

        return cleaned
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
        // Remove file extension
        let nameWithoutExt = filename.replacingOccurrences(of: ".png", with: "")

        // Try new format first: timestamp|||AppName|||WindowTitle
        if nameWithoutExt.contains("|||") {
            let components = nameWithoutExt.components(separatedBy: "|||")
            guard components.count >= 3 else { return (nil, nil) }

            let appName = components[1]
            let windowTitle = components[2]

            return (appName.isEmpty ? nil : appName,
                    windowTitle.isEmpty ? nil : windowTitle)
        }

        // Fallback to legacy format: timestamp_AppName_WindowTitle
        // This is a best-effort parser for old filenames
        let components = nameWithoutExt.components(separatedBy: "_")
        guard components.count >= 3 else { return (nil, nil) }

        // Known multi-word app names (most common)
        let multiWordApps = [
            "Google Chrome", "Visual Studio Code", "Microsoft Edge",
            "Adobe Photoshop", "Final Cut Pro", "Logic Pro",
            "Microsoft Word", "Microsoft Excel", "Microsoft PowerPoint",
            "Android Studio", "IntelliJ IDEA", "PyCharm",
            "Adobe Illustrator", "Adobe Premiere Pro"
        ]

        // Try to match known multi-word apps
        for knownApp in multiWordApps {
            let appWords = knownApp.components(separatedBy: " ")
            if components.count >= 1 + appWords.count + 1 { // timestamp + app words + at least 1 window word
                let potentialAppParts = components[1...(appWords.count)].joined(separator: " ")
                let normalized = potentialAppParts.replacingOccurrences(of: "_", with: " ")
                if normalized.lowercased() == knownApp.lowercased() {
                    let windowTitle = components.dropFirst(1 + appWords.count)
                        .joined(separator: " ")
                        .replacingOccurrences(of: "_", with: " ")
                        .replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
                        .trimmingCharacters(in: .whitespaces)
                    return (knownApp, windowTitle)
                }
            }
        }

        // If no known app matched, assume single-word app name
        let appName = components[1].replacingOccurrences(of: "_", with: " ")
        let windowTitle = components.dropFirst(2)
            .joined(separator: " ")
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "  +", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)

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
            objects: nil,
            extraction: nil
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
            objects: result.objects,
            extraction: result.extraction
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
