# Clearical Brand Guidelines

> Technical minimalism meets developer focus. A warm, approachable productivity tool.

---

## Brand Philosophy

Clearical is designed for developers and knowledge workers who value their time. The visual identity reflects:

- **Clarity** - Clean interfaces that don't distract from the task at hand
- **Warmth** - Approachable cream tones instead of cold grays
- **Precision** - Modern sans-serif typography that feels professional yet readable
- **Focus** - Minimal chrome, maximum content

---

## Color Palette

### Primary Colors

| Name | Hex | Usage |
|------|-----|-------|
| **Accent Orange** | `#FF4800` | Primary CTAs, active states, brand highlight |
| **Accent Hover** | `#EB4403` | Hover state for accent elements |
| **Accent Light** | `#FF6B35` | Gradients, lighter accents |

### Background Colors (Light Cream Theme)

| Name | Hex | Usage |
|------|-----|-------|
| **Primary Background** | `#F2F0ED` | Main app background - warm cream |
| **Secondary Background** | `#FFFFFF` | Cards, elevated surfaces |
| **Tertiary Background** | `#E8E6E3` | Inputs, nested elements |
| **Quaternary Background** | `#DAD8D5` | Hover states on tertiary |

### Text Colors

| Name | Hex | Usage |
|------|-----|-------|
| **Primary Text** | `#0D0C0C` | Headlines, body text |
| **Secondary Text** | `#6B6560` | Descriptions, labels |
| **Tertiary Text** | `#8C877D` | Placeholders, disabled states |

### Semantic Colors

| Name | Hex | Usage |
|------|-----|-------|
| **Success** | `#16A34A` | Connected states, positive actions |
| **Warning** | `#CA8A04` | Caution states, pending actions |
| **Error** | `#DC2626` | Errors, destructive actions, disconnect |
| **Info** | `#2563EB` | Informational elements (use sparingly) |

### Border Colors

| Name | Hex | Usage |
|------|-----|-------|
| **Primary Border** | `#E4E0DC` | Default borders |
| **Secondary Border** | `#D4D0CC` | Subtle dividers |

---

## Typography

> Typography matches the marketing website at [clearical.io](https://clearical.io)

### Font Families

| Purpose | Font | Fallbacks |
|---------|------|-----------|
| **Display** | DM Sans | system-ui, -apple-system, sans-serif |
| **Body** | Inter | system-ui, -apple-system, sans-serif |
| **Mono/Code** | JetBrains Mono | Fira Code, SF Mono, monospace |

### Usage Guidelines

- **Headlines & Section Titles**: DM Sans, Bold (700), tight tracking
- **Body Text**: Inter, Regular (400)
- **Buttons**: JetBrains Mono, Semibold (600)
- **Labels**: Inter, Semibold (600)
- **Micro Labels**: 10px, uppercase, wider tracking
- **Code/Data Values**: JetBrains Mono

### Font Sizes

| Token | Size | Usage |
|-------|------|-------|
| `text-xs` | 10px | Micro labels, badges |
| `text-sm` | 12px | Small labels, descriptions |
| `text-base` | 14px | Body text |
| `text-lg` | 18px | Card titles |
| `text-xl` | 20px | Section headers |
| `text-2xl` | 24px | Page titles |
| `text-timer` | 64px | Timer display |

---

## Component Patterns

### Buttons

#### Primary CTA
```css
background: var(--color-accent);
color: white;
border-radius: 9999px; /* pill shape */
font-family: var(--font-mono); /* JetBrains Mono */
font-weight: 600;
padding: 10px 24px;
```
- Use for main actions: "Continue", "Start Syncing", "Upgrade"
- Include hover scale effect: `transform: scale(1.05)`

#### Secondary Button
```css
background: var(--color-bg-tertiary);
color: var(--color-text-primary);
border: 1px solid var(--color-border-primary);
border-radius: 8px;
font-family: var(--font-mono); /* JetBrains Mono */
font-weight: 600;
```
- Use for alternative actions: "Check Again", "Configure"

#### Ghost Button
```css
background: transparent;
color: var(--color-text-secondary);
border: 1px solid var(--color-border-primary);
border-radius: 8px;
font-family: var(--font-mono); /* JetBrains Mono */
/* On hover: */
background: #FAF5EE; /* Warm cream hover */
color: var(--color-text-primary);
```
- Use for tertiary actions: "Back", "Cancel", "Skip for now", "Sign Out", "Reset"
- No font-weight change on hover to prevent width shifts

#### Destructive Button
```css
background: var(--color-error);
color: white;
border-radius: 8px;
font-family: var(--font-mono); /* JetBrains Mono */
font-weight: 600;
```
- Use for destructive actions: "Disconnect", "Delete"

### Cards & Containers

```css
background: var(--color-bg-secondary);
border: 1px solid var(--color-border-primary);
border-radius: 16px; /* rounded-2xl */
padding: 16px;
```

### Integration Row Pattern
Used for Jira, Tempo, Calendar, Permissions:
```
[Icon/Status] | [Title + Description] | [Status Badge] | [Action Button]
```
- Background: `var(--color-bg-tertiary)`
- Border radius: 8px
- Padding: 10px

### Status Badges

| State | Style |
|-------|-------|
| Connected | Green background muted, green text |
| Disabled | Gray background, gray text |
| Error | Red background muted, red text |
| Warning | Yellow background muted, yellow text |

```css
/* Connected */
background: rgba(22, 163, 74, 0.1);
color: #16A34A;

/* Disabled */
background: var(--color-bg-quaternary);
color: var(--color-text-tertiary);
```

### Progress Indicators

- Use accent color (`#FF4800`) for active/current state
- Use muted gray for incomplete states
- Pill shape for current step, circle for others

---

## Spacing

Based on 4px grid:

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight gaps |
| `space-2` | 8px | Default inline spacing |
| `space-3` | 12px | Card padding, element gaps |
| `space-4` | 16px | Section spacing |
| `space-6` | 24px | Large section spacing |

---

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-md` | 8px | Buttons, inputs, small cards |
| `radius-lg` | 12px | Cards, integration rows |
| `radius-xl` | 16px | Large cards |
| `radius-2xl` | 24px | Modal containers |
| `radius-full` | 9999px | Pills, avatars, primary CTAs |

---

## Shadows

Light, subtle shadows that don't compete with content:

```css
--shadow-sm: 0 2px 4px 0 rgba(0, 0, 0, 0.06);
--shadow-md: 0 4px 8px -2px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 8px 16px -4px rgba(0, 0, 0, 0.1);
```

---

## Animations

### Transitions
- Default duration: 200ms
- Easing: `cubic-bezier(0, 0, 0.2, 1)` (ease-out)

### Hover Effects
- Buttons: `transform: scale(1.05)` on primary CTAs
- Cards: Subtle border color change
- Ghost buttons: Background color fade in

### Page Transitions
- Slide animations for step-based flows
- Fade for modals and overlays

---

## Do's and Don'ts

### Do
- Use the accent orange for primary actions only
- Keep semantic colors consistent (green = success, red = error)
- Maintain generous whitespace
- Use JetBrains Mono for code/data values
- Use cream backgrounds, not pure gray
- Match typography to the marketing website

### Don't
- Use blue for decorative borders or highlights
- Add colored rings/outlines to cards (use subtle borders instead)
- Use more than one primary CTA per view
- Mix serif fonts with the sans-serif aesthetic
- Use dark mode except for specific contrast elements (like the sidebar)

---

## Accessibility

- Maintain WCAG AA contrast ratios (4.5:1 for text)
- All interactive elements must have visible focus states
- Focus ring: 2px accent orange with 2px offset
- Don't rely on color alone to convey meaning

---

## Voice & Tone

- **Clear**: No jargon, straightforward language
- **Concise**: Say more with less
- **Helpful**: Guide users to success
- **Technical**: Respect the user's intelligence

---

*Last updated: January 2026*
