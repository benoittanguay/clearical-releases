# AppBlacklistManager Component

A comprehensive UI component for managing the application blacklist feature in Clearical Settings. This component allows users to exclude specific applications from being tracked.

## Features

### 1. Blacklisted Apps Display
- Shows all currently blacklisted apps with their names and bundle IDs
- Apps are organized by category (Productivity, Developer Tools, Music & Audio, etc.)
- Visual indicators show excluded apps with red badges
- Summary count displays total blacklisted apps
- Remove button for each app with hover state

### 2. Add Apps Interface
- Modal dialog with smooth animations
- Search functionality to filter apps by name or bundle ID
- Apps grouped by category with collapsible sections
- Expand/Collapse All buttons for quick navigation
- Shows app icons (placeholder SVG icons included)
- Only shows apps that aren't already blacklisted

### 3. Categories
Apps are organized into these categories:
- Productivity
- Developer Tools
- Music & Audio
- Video
- Games
- Social
- Browsers
- Communication
- Utilities
- Other (default)

### 4. User Experience
- Loading states with helpful messages
- Empty states with guidance
- Error handling with user-friendly messages
- Responsive design that works at all viewport sizes
- Dark theme styling consistent with Clearical's design system
- Smooth transitions and hover effects

## Component Structure

```
AppBlacklistManager/
├── Main Component
│   ├── Blacklisted Apps List
│   │   ├── Summary Badge
│   │   └── Category Groups
│   │       └── App Items (with remove button)
│   └── Add Apps Button
│
└── Add Apps Modal
    ├── Header with Close Button
    ├── Search Bar
    ├── Expand/Collapse Controls
    ├── Category Groups (collapsible)
    │   └── App Items (with add button)
    └── Footer with Done Button
```

## IPC Methods Required

The component uses these Electron IPC methods (to be implemented in the backend):

```typescript
// Get all blacklisted apps
window.electronAPI.invoke('get-blacklisted-apps')
  → Returns: BlacklistedApp[]

// Add an app to the blacklist
window.electronAPI.invoke('add-blacklisted-app', {
  bundleId: string,
  name: string,
  category?: AppCategory
})
  → Returns: void

// Remove an app from the blacklist
window.electronAPI.invoke('remove-blacklisted-app', bundleId: string)
  → Returns: void

// Get all installed apps on the system
window.electronAPI.invoke('get-installed-apps')
  → Returns: InstalledApp[]
```

## TypeScript Interfaces

```typescript
export type AppCategory =
    | 'Productivity'
    | 'Developer Tools'
    | 'Music & Audio'
    | 'Video'
    | 'Games'
    | 'Social'
    | 'Browsers'
    | 'Communication'
    | 'Utilities'
    | 'Other';

export interface BlacklistedApp {
    bundleId: string;    // Unique identifier (e.g., "com.google.Chrome")
    name: string;        // Display name (e.g., "Google Chrome")
    category?: AppCategory;
}

export interface InstalledApp {
    bundleId: string;    // Unique identifier
    name: string;        // Display name
    category?: AppCategory;
    iconPath?: string;   // Optional path to app icon
}
```

## Usage in Settings

```tsx
import { AppBlacklistManager } from './AppBlacklistManager';

// In Settings.tsx
<div className="bg-gray-800 p-3 rounded-lg mb-3">
    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">
        App Exclusions
    </h3>
    <AppBlacklistManager />
</div>
```

## Styling

The component follows Clearical's design system:
- **Background Colors**: gray-800 (cards), gray-900 (inputs/items)
- **Border Colors**: gray-700
- **Text Colors**: white (primary), gray-400 (secondary), gray-500/600 (tertiary)
- **Accent Colors**:
  - Blue (blue-600/500) for primary actions
  - Red (red-900/400) for remove actions and excluded badges
  - Green (green-500) for focus rings
- **Border Radius**: rounded, rounded-lg
- **Spacing**: Consistent 2.5/3/4 padding scale
- **Transitions**: All interactive elements have smooth color transitions

## Accessibility

- Semantic HTML structure
- Proper button labels and titles
- Keyboard navigable
- Focus states on all interactive elements
- Screen reader friendly text

## Performance Considerations

- Apps are only loaded when the modal is opened
- Search filtering happens client-side for instant results
- Categories are collapsed by default to reduce DOM size
- Efficient re-rendering with React state management

## Future Enhancements

1. **App Icons**: Currently uses placeholder SVG. Can be enhanced to show actual app icons using the `iconPath` from `InstalledApp`
2. **Bulk Operations**: Add ability to select multiple apps at once
3. **Category Blacklisting**: Add option to blacklist entire categories
4. **Import/Export**: Allow users to export and import blacklist configurations
5. **Recently Used**: Show recently used apps at the top for quick access
6. **Usage Stats**: Show how much time would have been tracked for blacklisted apps
7. **Temporary Exclusion**: Option to temporarily exclude apps (e.g., for 1 hour)

## Testing Checklist

- [ ] Loading state displays correctly
- [ ] Empty state displays when no apps are blacklisted
- [ ] Search filters apps by name and bundle ID
- [ ] Categories expand and collapse correctly
- [ ] Add button adds app to blacklist
- [ ] Remove button removes app from blacklist
- [ ] Modal opens and closes properly
- [ ] Expand/Collapse All buttons work
- [ ] Responsive at different viewport sizes
- [ ] Error states display properly
- [ ] No duplicate apps can be added
- [ ] Apps are sorted alphabetically within categories
