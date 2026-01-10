/**
 * AppBlacklistManager - Visual Examples
 *
 * This file shows examples of the component in different states.
 * These are for documentation purposes only.
 */

import { AppBlacklistManager } from './AppBlacklistManager';

/**
 * EXAMPLE 1: Empty State
 * When no apps are blacklisted
 */
export function EmptyStateExample() {
    return (
        <div className="bg-gray-900 p-8 min-h-screen">
            <div className="max-w-2xl mx-auto">
                <div className="bg-gray-800 p-3 rounded-lg">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                        App Exclusions
                    </h3>
                    <AppBlacklistManager />
                </div>
            </div>
        </div>
    );
}

/**
 * EXAMPLE 2: With Blacklisted Apps
 * Component with several apps already blacklisted
 *
 * Expected Display:
 * ┌─────────────────────────────────────┐
 * │ App Exclusions                      │
 * ├─────────────────────────────────────┤
 * │ Exclude specific apps from being    │
 * │ tracked. Screenshots from           │
 * │ blacklisted apps will not be        │
 * │ captured.                           │
 * ├─────────────────────────────────────┤
 * │ [!] 3 apps blacklisted  [EXCLUDED]  │
 * ├─────────────────────────────────────┤
 * │ BROWSERS                            │
 * │ ┌───────────────────────────────┐   │
 * │ │ [icon] Google Chrome          │ X │
 * │ │        com.google.Chrome      │   │
 * │ ├───────────────────────────────┤   │
 * │ │ [icon] Safari                 │ X │
 * │ │        com.apple.Safari       │   │
 * │ └───────────────────────────────┘   │
 * ├─────────────────────────────────────┤
 * │ GAMES                               │
 * │ ┌───────────────────────────────┐   │
 * │ │ [icon] Steam                  │ X │
 * │ │        com.valvesoftware.steam│   │
 * │ └───────────────────────────────┘   │
 * ├─────────────────────────────────────┤
 * │ [+] Add Apps to Blacklist           │
 * └─────────────────────────────────────┘
 */
export function WithAppsExample() {
    return (
        <div className="bg-gray-900 p-8 min-h-screen">
            <div className="max-w-2xl mx-auto">
                <div className="bg-gray-800 p-3 rounded-lg">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
                        App Exclusions
                    </h3>
                    <AppBlacklistManager />
                </div>
            </div>
        </div>
    );
}

/**
 * EXAMPLE 3: Add Apps Modal
 * Modal showing installed apps grouped by category
 *
 * Expected Display:
 * ┌────────────────────────────────────────────┐
 * │ Add Apps to Blacklist              [Close] │
 * ├────────────────────────────────────────────┤
 * │ [Search] Search apps by name or bundle ID  │
 * │ Expand All • Collapse All                  │
 * ├────────────────────────────────────────────┤
 * │ ▼ PRODUCTIVITY (5)                         │
 * │ ┌──────────────────────────────────────┐   │
 * │ │ [icon] Slack                    [Add]│   │
 * │ │        com.tinyspeck.slackmacgap     │   │
 * │ ├──────────────────────────────────────┤   │
 * │ │ [icon] Notion                   [Add]│   │
 * │ │        notion.id                     │   │
 * │ └──────────────────────────────────────┘   │
 * │                                            │
 * │ ▶ DEVELOPER TOOLS (12)                     │
 * │                                            │
 * │ ▶ BROWSERS (4)                             │
 * ├────────────────────────────────────────────┤
 * │                                      [Done]│
 * └────────────────────────────────────────────┘
 */

/**
 * EXAMPLE 4: Search Results
 * Modal with active search filtering apps
 */

/**
 * UI SPECIFICATIONS
 *
 * Colors:
 * - Primary background: bg-gray-800 (#1F2937)
 * - Secondary background: bg-gray-900 (#111827)
 * - Border: border-gray-700 (#374151)
 * - Primary text: text-white (#FFFFFF)
 * - Secondary text: text-gray-400 (#9CA3AF)
 * - Tertiary text: text-gray-500 (#6B7280)
 * - Action button: bg-blue-600 (#2563EB) / hover:bg-blue-500 (#3B82F6)
 * - Remove button: hover:bg-red-900/30 / text-red-400 (#F87171)
 * - Excluded badge: bg-red-900/30 text-red-400
 *
 * Spacing:
 * - Section padding: p-3 (12px)
 * - Item padding: p-2.5 (10px)
 * - Vertical gaps: space-y-2 (8px) or space-y-3 (12px)
 *
 * Typography:
 * - Section headers: text-xs font-semibold text-gray-400 uppercase
 * - App names: text-sm font-medium text-white
 * - Bundle IDs: text-xs text-gray-500
 * - Descriptions: text-xs text-gray-500
 *
 * Borders:
 * - Cards: rounded-lg border border-gray-700
 * - Buttons: rounded
 *
 * Icons:
 * - Size: w-4 h-4 or w-5 h-5
 * - App icon placeholder: w-8 h-8
 *
 * Transitions:
 * - All interactive elements: transition-colors
 * - Duration: 150ms (default)
 *
 * Layout:
 * - Modal max width: max-w-2xl
 * - Modal max height: max-h-[80vh]
 * - Modal margin: m-4
 */

/**
 * INTERACTION STATES
 *
 * Default States:
 * - Loading: "Loading blacklisted apps..." in center
 * - Empty: "No apps blacklisted" with helpful description
 * - Error: Red banner at top with error message
 *
 * Hover States:
 * - App items: hover:bg-gray-800
 * - Add button: hover:bg-blue-500
 * - Remove button: hover:bg-red-900/30
 * - Category header: hover:bg-gray-800
 *
 * Active States:
 * - Search input: focus:ring-1 focus:ring-blue-500
 * - Expanded category: rotated chevron (rotate-90)
 *
 * Disabled States:
 * - None (all actions are always available)
 */

/**
 * RESPONSIVE BEHAVIOR
 *
 * Desktop (>= 768px):
 * - Modal: max-w-2xl centered
 * - App items: full layout with icons and buttons side-by-side
 *
 * Mobile (< 768px):
 * - Modal: full width with m-4 margin
 * - App items: stacked layout (would need @media queries if implemented)
 * - Search bar: full width
 *
 * All Sizes:
 * - Text truncates with ellipsis when too long
 * - Modal scrolls vertically when content exceeds max-h-[80vh]
 * - Categories collapse by default to reduce scroll
 */
