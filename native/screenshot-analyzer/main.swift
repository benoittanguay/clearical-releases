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

// Structured extraction data
struct ExtractedText: Codable {
    let filenames: [String]
    let code: [String]
    let urls: [String]
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
                    print("Failed to parse prompt config at \(promptPath): \(error)")
                }
            }
        }

        print("Failed to load prompt config from any location, using defaults")
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

        // Generate structured extraction from detected text and objects
        let extraction = self.generateStructuredExtraction(
            detectedText: detectedText,
            detectedObjects: detectedObjects,
            imagePath: path
        )

        // Generate natural language description from structured data
        analysisDescription = self.generateNarrativeFromExtraction(
            extraction: extraction,
            imagePath: path
        )

        completion(AnalysisResponse(
            success: true,
            requestId: nil,
            description: analysisDescription,
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
        var filenames: [String] = []
        var code: [String] = []
        var urls: [String] = []
        var commands: [String] = []
        var uiLabels: [String] = []
        var documentText: [String] = []
        var errors: [String] = []
        var projectIdentifiers: [String] = []

        // File extensions to look for
        let fileExtensions = [".tsx", ".ts", ".jsx", ".js", ".swift", ".py", ".java", ".go", ".rs", ".cpp", ".c", ".h", ".json", ".yaml", ".yml", ".toml", ".md", ".txt", ".css", ".html", ".xml"]

        for text in detectedText {
            let textLower = text.lowercased()

            // Categorize filenames and paths
            if fileExtensions.contains(where: { text.hasSuffix($0) }) || text.contains("/") || text.contains("\\") {
                filenames.append(text)
            }

            // Categorize code patterns
            if textLower.contains("function") || textLower.contains("const ") || textLower.contains("let ") ||
               textLower.contains("var ") || textLower.contains("import ") || textLower.contains("export ") ||
               textLower.contains("class ") || textLower.contains("interface ") || textLower.contains("type ") ||
               textLower.contains("func ") || textLower.contains("def ") || textLower.contains("async ") {
                code.append(text)
            }

            // Categorize URLs
            if textLower.contains("http://") || textLower.contains("https://") || textLower.contains("localhost") ||
               textLower.contains("://") || textLower.contains(".com") || textLower.contains(".org") {
                urls.append(text)
            }

            // Categorize commands
            if textLower.starts(with: "npm ") || textLower.starts(with: "git ") || textLower.starts(with: "$") ||
               textLower.starts(with: "yarn ") || textLower.starts(with: "docker ") || textLower.contains("cargo ") {
                commands.append(text)
            }

            // Categorize errors
            if textLower.contains("error") || textLower.contains("exception") || textLower.contains("failed") ||
               textLower.contains("warning") || textLower.contains("stack trace") || textLower.contains("cannot") {
                errors.append(text)
            }

            // Categorize project identifiers
            if textLower.contains("project") || text.contains("PROJ-") || text.contains("JIRA-") ||
               (text.count > 3 && text.count < 30 && text.first?.isUppercase == true && !text.contains(" ")) {
                projectIdentifiers.append(text)
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
        for text in detectedText {
            let pattern = "[A-Z]{2,10}-[0-9]+"
            if let regex = try? NSRegularExpression(pattern: pattern) {
                let range = NSRange(text.startIndex..., in: text)
                let matches = regex.matches(in: text, range: range)
                for match in matches {
                    if let range = Range(match.range, in: text) {
                        issueRefs.append(String(text[range]))
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
            let components = filename.components(separatedBy: "/")
            for component in components {
                let componentLower = component.lowercased()
                if !["src", "lib", "components", "utils", "node_modules", "build", "dist", "tests", "test", "public", "assets", "styles", "electron", "native", "landing"].contains(componentLower) && component.count > 3 {
                    // Capitalize first letter
                    projectName = component.prefix(1).uppercased() + component.dropFirst()
                    break
                }
            }
            if projectName != nil { break }
        }

        // Fallback to directory structure
        if projectName == nil {
            for path in directoryStructure {
                if !["src", "lib", "components", "utils", "node_modules", "build", "dist", "tests", "test", "public", "assets", "styles", "electron", "native"].contains(path.lowercased()) && path.count > 2 {
                    projectName = path
                    break
                }
            }
        }

        // Last resort: check project identifiers
        if projectName == nil && !projectIdentifiers.isEmpty {
            projectName = projectIdentifiers.first
        }

        let projectContext = ProjectContext(
            projectName: projectName,
            directoryStructure: directoryStructure,
            branchName: nil,
            issueReferences: issueRefs,
            featureName: nil,
            configFiles: configFiles
        )

        // === DETECT TECHNOLOGIES ===
        var technologies: [String] = []
        let techKeywords: [(String, [String])] = [
            ("React", ["react", "jsx", "tsx", "usestate", "useeffect", "component"]),
            ("TypeScript", ["typescript", "interface", "type", ".ts", ".tsx"]),
            ("JavaScript", ["javascript", ".js", "node", "npm"]),
            ("Swift", ["swift", "func", "import foundation", ".swift"]),
            ("Python", ["python", "def", "import", ".py"]),
            ("Electron", ["electron", "ipcmain", "ipcrenderer", "browserwindow"]),
            ("Git", ["git", "commit", "branch", "merge", "push"]),
            ("Jira", ["jira", "issue", "ticket", "sprint"]),
            ("Tempo", ["tempo", "timesheet", "worklog"]),
            ("Docker", ["docker", "container", "dockerfile"])
        ]

        for (tech, keywords) in techKeywords {
            if keywords.contains(where: { allTextLower.contains($0) }) {
                technologies.append(tech)
            }
        }

        // === DETECT ACTIVITIES ===
        var activities: [String] = []
        if !code.isEmpty {
            activities.append("Coding")
        }
        if !errors.isEmpty {
            activities.append("Debugging")
        }
        if allTextLower.contains("test") || allTextLower.contains("spec") {
            activities.append("Testing")
        }
        if allTextLower.contains("documentation") || allTextLower.contains("readme") {
            activities.append("Documentation")
        }
        if !commands.isEmpty {
            activities.append("Command-line operations")
        }

        let extractedText = ExtractedText(
            filenames: filenames,
            code: code,
            urls: urls,
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

    // MARK: - Narrative Generation (Step 2)
    private func generateNarrativeFromExtraction(extraction: StructuredExtraction, imagePath: String) -> String {
        // Part 1: Determine the primary activity (without raw error text)
        let activities = extraction.detectedActivities
        let hasErrors = !extraction.extractedText.errors.isEmpty
        let code = extraction.extractedText.code

        var taskDescription = ""
        if hasErrors {
            // Just say "Debugging" without including the actual error message
            taskDescription = "Debugging"
        } else if !code.isEmpty && activities.contains("Coding") {
            // Be specific about what kind of coding
            if let firstCode = code.first {
                let codeLower = firstCode.lowercased()
                if codeLower.contains("function") || codeLower.contains("func") {
                    taskDescription = "Implementing functions"
                } else if codeLower.contains("interface") || codeLower.contains("type") {
                    taskDescription = "Defining types"
                } else if codeLower.contains("import") || codeLower.contains("export") {
                    taskDescription = "Organizing imports"
                } else {
                    taskDescription = "Writing code"
                }
            } else {
                taskDescription = "Writing code"
            }
        } else if !activities.isEmpty {
            taskDescription = activities.first ?? "Working"
        } else {
            taskDescription = "Working"
        }

        // Part 2: Identify project name from various sources
        var projectName: String? = nil

        // Try to extract project name from directory structure
        let directories = extraction.projectContext.directoryStructure
        let commonGenericDirs = ["src", "lib", "components", "utils", "node_modules", "build", "dist", "tests", "test", "public", "assets", "styles", "electron", "native"]

        for dir in directories {
            let dirLower = dir.lowercased()
            if !commonGenericDirs.contains(dirLower) && dir.count > 2 {
                // Capitalize properly (TimePortal instead of timeportal)
                projectName = dir.prefix(1).uppercased() + dir.dropFirst()
                break
            }
        }

        // Fallback to extraction.projectContext.projectName if available
        if projectName == nil {
            projectName = extraction.projectContext.projectName
        }

        var projectInfo = ""
        if let project = projectName {
            projectInfo = " on the \(project) project"
        }

        // Part 3: Identify what specific file/module is being worked on
        var fileInfo = ""
        if let fileContext = extraction.fileContext, let filename = fileContext.filename {
            // Clean up the filename - remove git status indicators and truncation artifacts
            let cleanFilename = cleanupFilename(filename)

            // Extract just the directory/module path for context, not the full filename
            if let language = fileContext.language {
                // If we have a path structure, extract the relevant module
                if cleanFilename.contains("/") {
                    let pathComponents = cleanFilename.components(separatedBy: "/")
                    if pathComponents.count > 1 {
                        // Get the module folder (e.g., "electron/licensing" from a full path)
                        let moduleComponents = pathComponents.dropLast().suffix(2)
                        let module = moduleComponents.joined(separator: "/")
                        fileInfo = ", editing \(language) files in the \(module) module"
                    } else {
                        fileInfo = ", editing \(cleanFilename)"
                    }
                } else {
                    // Just a filename, include it
                    fileInfo = ", editing \(cleanFilename)"
                }
            } else if !cleanFilename.isEmpty {
                fileInfo = ", working on \(cleanFilename)"
            }
        }

        // Part 4: Application and mode
        let appContext = extraction.visualContext.application
        var appDetail = "Using \(appContext)"
        if let mode = extraction.visualContext.applicationMode {
            // Clean up mode description
            if mode == "Debug mode" {
                appDetail += " with debugger"
            } else if mode.contains("Terminal") {
                appDetail += " with integrated terminal"
            } else {
                appDetail += " in \(mode)"
            }
        }

        // Part 5: Technologies (limit to 3 most relevant)
        var techContext = ""
        if !extraction.detectedTechnologies.isEmpty {
            let techs = Array(extraction.detectedTechnologies.prefix(3))
            techContext = " with \(techs.joined(separator: ", "))"
        }

        // Assemble the final narrative (2-3 sentences max)
        var parts: [String] = []

        // Sentence 1: Activity + Project + File context
        parts.append(taskDescription + projectInfo + fileInfo + ".")

        // Sentence 2: Application + Technologies
        parts.append(appDetail + techContext + ".")

        return parts.joined(separator: " ")
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
