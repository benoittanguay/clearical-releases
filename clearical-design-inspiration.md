# Clearical Marketing Website - Design Inspiration

> Cross-referenced with Clearical Brand Guidelines & Design Tokens

---

## Brand Alignment Summary

The inspiration images share remarkable alignment with Clearical's existing brand:

| Inspiration Pattern | Clearical Brand Token | Alignment |
|--------------------|-----------------------|-----------|
| Warm cream backgrounds | `--color-bg-primary: #F2F0ED` | Direct match |
| Orange accent color | `--color-accent: #FF4800` | Direct match |
| Dark text on light | `--color-text-primary: #0D0C0C` | Direct match |
| Pill-shaped CTAs | `--radius-full: 9999px` | Direct match |
| Sans-serif typography | DM Sans + Inter | Compatible |
| Monospace for technical | JetBrains Mono | Direct match |
| Subtle borders | `--color-border-primary: #E4E0DC` | Direct match |
| 4px spacing grid | `--space-1` through `--space-24` | Direct match |

---

## Detailed Image Analysis

### Reference 1: Design System Components

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Warm cream `~#F5F3EE` | `--color-bg-primary: #F2F0ED` |
| Card backgrounds | Pure white | `--color-bg-secondary: #FFFFFF` |
| Primary button | Dark fill, pill shape | `--color-surface-dark` + `--radius-full` |
| Secondary button | White fill, dark border | `--color-bg-secondary` + `--color-border-primary` |
| Small button variant | Dark fill, rounded rect | `--radius-md: 8px` |
| Icon buttons | Circle, gray fill | `--color-bg-tertiary` + `--radius-full` |
| Tag "ALL" | Coral/salmon fill `~#E8A87C` | Use `--color-accent-light: #FF6B35` |
| Tag "MOODBOARD" | Dark fill, rounded | `--color-surface-dark` + `--radius-md` |
| Checkbox checked | Coral/salmon fill | `--color-accent` |
| Radio checked | Dark fill | `--color-text-primary` |
| Input fields | White bg, subtle border | `--color-bg-secondary` + `--color-border-primary` |
| Slider thumb | Dark with value tooltip | `--color-surface-dark` |
| Accordion expanded | Coral accent link text | `--color-accent` for links |
| Section labels | Small caps, muted | `--text-xs` + `--color-text-secondary` |

**Key Patterns to Adopt:**
- Component cards with generous padding (24-32px)
- Clear visual hierarchy with muted section labels
- Warm coral/orange as interactive accent
- Payment icons row for trust signals

**Clearical Implementation:**
```css
/* Design system card container */
.ds-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl); /* 16px */
  padding: var(--space-6); /* 24px */
}

/* Section label above components */
.ds-section-label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--space-3);
}
```

---

### Reference 2: Orren AI - Hero with Grid Background

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Off-white with grid overlay | `--color-bg-primary` + `.grid-pattern` |
| Grid lines | Very subtle `~3% opacity` | `rgba(0, 0, 0, 0.03)` |
| Grid size | ~60px cells | Match existing `60px 60px` |
| Announcement pill | Two-tone: light + dark CTA | Custom component needed |
| Headline font | Serif, bold, ~48-56px | **Gap**: Need serif option |
| Headline tracking | Tight, ~-0.02em | `--tracking-tight` |
| Subtext | Sans-serif, muted, centered | `--font-body` + `--color-text-secondary` |
| Input field | Dark bg, rounded, centered | `--color-surface-dark` + `--radius-lg` |
| Feature pills | White bg, dark border, icon+text | Ghost button pattern |
| Logo bar | Grayscale, centered, generous spacing | New component |
| Logo bar heading | Serif italic | **Gap**: Need serif option |

**Announcement Pill Component:**
```
┌─────────────────────────────────────┐
│  "Introducing Orren"  │ Try now →  │
│  (muted text)         │ (dark bg)  │
└─────────────────────────────────────┘
```

**Clearical Implementation:**
```css
/* Announcement pill - compound component */
.announcement-pill {
  display: inline-flex;
  align-items: center;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
  gap: var(--space-2);
}

.announcement-pill__text {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.announcement-pill__cta {
  background: var(--color-surface-dark);
  color: var(--color-text-inverse);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}

/* Hero grid background */
.hero-grid {
  background-color: var(--color-bg-primary);
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px);
  background-size: 60px 60px;
}

/* Dark search input */
.hero-input {
  background: var(--color-surface-dark);
  color: var(--color-text-inverse);
  border: none;
  border-radius: var(--radius-lg);
  padding: var(--space-4) var(--space-6);
  font-family: var(--font-body);
  font-size: var(--text-base);
  min-width: 480px;
}

/* Feature pills row */
.feature-pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: center;
}

.feature-pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-primary);
  background: var(--color-bg-secondary);
}
```

---

### Reference 3: Vooma - Tabbed Feature Showcase

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Section label | Small caps "SOLUTIONS" | `--text-xs` uppercase |
| Headline | Large sans-serif, multi-line | `--text-4xl` + `--font-display` |
| CTA button | Orange text + icon, no fill | `--color-accent` text button |
| Tab navigation | Text + number, underline active | Custom tab component |
| Tab numbers | Small, muted "01", "02" | `--text-sm` + `--color-text-tertiary` |
| Active tab | Border-bottom accent | `--color-accent` 2px bottom |
| Content split | 40% text / 60% image | CSS Grid or Flexbox |
| Feature image | Dark overlay with floating UI | Composited screenshot |
| Floating cards | Rounded, slight shadow | `--radius-lg` + `--shadow-md` |
| Chat interface | Teal/green accent | `--color-success` or custom |

**Tab Navigation Pattern:**
```
Quote        Build         Schedule      Cover         Track
  01    │      02      │      03      │     04     │     05
────────┴──────────────┴──────────────┴────────────┴──────────
        ▲ active (orange underline)
```

**Clearical Implementation:**
```css
/* Section label */
.section-label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  margin-bottom: var(--space-4);
}

/* Page headline */
.page-headline {
  font-family: var(--font-display);
  font-size: var(--text-4xl); /* 40px */
  font-weight: var(--font-bold);
  color: var(--color-text-primary);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

/* Orange text CTA */
.cta-text {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--color-accent);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

/* Tab navigation */
.tab-nav {
  display: flex;
  border-bottom: 1px solid var(--color-border-primary);
}

.tab-item {
  position: relative;
  padding: var(--space-4) var(--space-6);
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.tab-item__number {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  margin-left: var(--space-2);
}

.tab-item--active {
  color: var(--color-text-primary);
}

.tab-item--active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-accent);
}

/* Split content layout */
.split-content {
  display: grid;
  grid-template-columns: 2fr 3fr;
  gap: var(--space-8);
  align-items: start;
}
```

---

### Reference 4: PlayerZero - Node Diagram Hero

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Warm cream with subtle grid | `--color-bg-primary` |
| Logo | Simple icon, top-left | Standard placement |
| Nav items | Sans-serif, regular weight | `--font-body` |
| Hero text | Condensed caps "FIX. LEARN." | **Special**: Display font |
| Node diagram | Connecting lines, red accent | SVG with `--color-error` |
| Node labels | Small pills with text | `--radius-md` pills |
| Center icon | Large rounded square, embossed | 3D effect, `--radius-2xl` |
| CTA button | Icon + text, pill shape | `--radius-full` |
| Social proof | 4-column grid with stats | Bento-style cards |
| Stats | Large number + label | `--text-3xl` + `--text-sm` |
| Testimonial | Italic quote with attribution | Serif italic option |
| Section text | Mixed weight headline | Bold + regular combo |
| Dot pattern | Halftone/stipple effect | SVG or canvas pattern |

**Social Proof Grid:**
```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   KEYDATA    │    zuora     │   cayuse     │  [CTA Card]  │
│              │              │              │              │
│     3x       │  "Quote..."  │    98%       │  Connect     │
│  Faster...   │   - Name     │  Defects...  │  Sign up →   │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

**Clearical Implementation:**
```css
/* Display headline - condensed caps */
.hero-display {
  font-family: var(--font-display);
  font-size: var(--text-5xl); /* 48px */
  font-weight: var(--font-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-tight);
  color: var(--color-text-primary);
}

/* Node label pill */
.node-label {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-3);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--color-text-primary);
}

/* Stats card */
.stats-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
}

.stats-card__number {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--color-text-primary);
}

.stats-card__label {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin-top: var(--space-1);
}

/* Testimonial quote */
.testimonial-quote {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-style: italic;
  color: var(--color-text-primary);
  line-height: var(--leading-relaxed);
}

.testimonial-attribution {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin-top: var(--space-2);
}

/* Mixed weight headline */
.mixed-headline {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  color: var(--color-text-primary);
  line-height: var(--leading-snug);
}

.mixed-headline__light {
  font-weight: var(--font-normal);
  color: var(--color-text-secondary);
}

/* Example: "Introducing Sim-1" + "Our smartest models..." */
```

---

### Reference 5: Hiro - Developer Tools Platform

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Top banner | Orange bg, white text, link | `--color-accent` banner |
| Header | White bg, clean nav | Standard header |
| Hero section | Orange/coral gradient bg | `--color-accent` to `--color-accent-light` |
| Hero headline | White, bold, all caps | Inverse text on accent |
| Code preview | Dark terminal aesthetic | `--color-surface-dark` |
| Section headline | All caps, spaced | `--tracking-wider` |
| Product cards | White bg, icon + title + desc | Card component |
| Card tags | Small pills "STACKS", "ORDINALS" | Tag component |
| Card code | Monospace, syntax highlighted | `--font-mono` |
| Feature grid | 3-column, icon + title + body | CSS Grid |
| Blog section | Dark bg, card grid | Inverse section |
| Footer | Dark bg, multi-column links | Standard footer |

**Product Card Pattern:**
```
┌─────────────────────────────────────┐
│  ● STACKS    ○ ORDINALS    NEW      │  ← Tags
├─────────────────────────────────────┤
│  Chainhook                          │  ← Title
│                                     │
│  Build smarter apps with            │  ← Description
│  webhook-like triggers...           │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ "if_this": {                │    │  ← Code preview
│  │   "protocol": "ordinals",  │    │
│  │   ...                      │    │
│  │ }                          │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Clearical Implementation:**
```css
/* Accent banner */
.accent-banner {
  background: var(--color-accent);
  color: white;
  padding: var(--space-2) var(--space-4);
  text-align: center;
  font-family: var(--font-body);
  font-size: var(--text-sm);
}

.accent-banner a {
  color: white;
  text-decoration: underline;
  font-weight: var(--font-semibold);
}

/* Hero with gradient */
.hero-accent {
  background: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-light) 100%);
  color: white;
  padding: var(--space-16) var(--space-6);
}

.hero-accent__headline {
  font-family: var(--font-display);
  font-size: var(--text-5xl);
  font-weight: var(--font-extrabold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-tight);
}

/* Section headline - all caps */
.section-headline-caps {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-primary);
}

/* Product card */
.product-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.product-card__tags {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.product-card__tag {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wider);
  color: var(--color-text-tertiary);
}

.product-card__tag--active {
  color: var(--color-accent);
}

.product-card__tag--new {
  background: var(--color-success);
  color: white;
  padding: 2px var(--space-2);
  border-radius: var(--radius-sm);
}

.product-card__title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--color-text-primary);
}

.product-card__code {
  background: var(--color-surface-dark);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-inverse);
  overflow-x: auto;
}

/* Dark section */
.section-dark {
  background: var(--color-surface-dark);
  color: var(--color-text-inverse);
  padding: var(--space-16) var(--space-6);
}
```

---

### Reference 6: Qatalog - AI Search Interface

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Pure white | `--color-bg-secondary` |
| Header | Minimal, logo + nav + CTAs | Clean header |
| CTA button | Dark fill, pill | Primary button |
| Secondary CTA | Text only with arrow | Ghost/text button |
| Hero headline | Large serif, tight leading | **Gap**: Serif font |
| Search input | White bg, dark border, pill CTA | Compound input |
| Floating cards | Screenshots with shadow | `--shadow-lg` |
| Card arrangement | Overlapping, rotated | CSS transforms |
| Vertical tabs | Left sidebar with accent line | Tab variant |
| Active tab | Orange left border | `--color-accent` border |
| Response card | White, rounded, shadow | Card component |

**Floating Cards Effect:**
```css
/* Floating product screenshots */
.floating-cards {
  position: relative;
  height: 400px;
}

.floating-card {
  position: absolute;
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--space-4);
}

.floating-card--left {
  transform: rotate(-6deg) translateX(-20px);
  z-index: 1;
}

.floating-card--center {
  z-index: 3;
}

.floating-card--right {
  transform: rotate(4deg) translateX(20px);
  z-index: 2;
}

/* Vertical tabs */
.vertical-tabs {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.vertical-tab {
  position: relative;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-text-secondary);
  cursor: pointer;
  border-left: 2px solid transparent;
}

.vertical-tab--active {
  color: var(--color-text-primary);
  font-weight: var(--font-medium);
  border-left-color: var(--color-accent);
  background: var(--color-accent-muted);
}

/* Search input with embedded CTA */
.search-compound {
  display: flex;
  align-items: center;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-full);
  padding: var(--space-1);
  padding-left: var(--space-4);
}

.search-compound__input {
  flex: 1;
  border: none;
  background: transparent;
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--color-text-primary);
}

.search-compound__button {
  background: var(--color-surface-dark);
  color: var(--color-text-inverse);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
```

---

### Reference 7: Cyber Monday - Retro Promo Page

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Light cream `~#F5F3EE` | `--color-bg-primary` |
| Section label | Small caps, centered | Section label pattern |
| Display text | Pixel/bitmap font | **Special**: Decorative only |
| Hero image | 3D retro TV, holographic | Custom illustration |
| Body text | Clean sans-serif | `--font-body` |
| CTA button | Dark fill, pill shape | Primary button |
| Marquee strip | Repeating "ONLY TODAY →" | Animated marquee |
| Product grid | 2-column below fold | CSS Grid |

**Marquee Animation:**
```css
/* Scrolling marquee */
.marquee {
  overflow: hidden;
  white-space: nowrap;
  background: var(--color-bg-primary);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--color-border-primary);
  border-bottom: 1px solid var(--color-border-primary);
}

.marquee__content {
  display: inline-flex;
  animation: marquee 20s linear infinite;
}

.marquee__item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-6);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
  color: var(--color-text-primary);
}

@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
```

**Clearical Application**: Use pixel aesthetic sparingly for special promotions or playful moments, but maintain brand consistency with the existing JetBrains Mono for most technical/retro feels.

---

### Reference 8: Bento Grid Features (Dark + Light)

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Grid layout | 3x2 bento box | CSS Grid |
| Dark variant | Near-black `~#1A1A1A` | `--color-surface-dark` |
| Light variant | Off-white `~#FAF9F7` | `--color-bg-primary` |
| Card borders | 1px subtle | `--color-border-primary` |
| Card radius | ~16-20px | `--radius-xl` |
| Accent card | Vibrant orange `~#FF6B35` | `--color-accent-light` |
| Card icons | Abstract, gradient | Custom illustrations |
| Audio wave | Orange bars animation | `--color-accent` |
| Avatar stack | Overlapping circles | Z-index stacking |
| Growth line | Orange path on light bg | SVG with accent |
| Feature title | Bold, white (dark) / black (light) | Inverse text |
| Description | Muted, smaller | `--color-text-secondary` |
| Arrow icon | Top-right on accent card | Directional indicator |

**Bento Grid Layout:**
```
┌─────────────┬─────────────┬─────────────┐
│             │             │             │
│   Track     │    Team     │   CTA       │
│   Progress  │ Integration │   Card      │
│             │             │  (ORANGE)   │
├─────────────┼─────────────┤             │
│             │             │             │
│   Popular   │    Fast     ├─────────────┤
│   Apps      │ Iterations  │ Impressions │
│             │             │  & Growth   │
├─────────────┼─────────────┤             │
│   Custom    │             │             │
│   Support   │             │             │
└─────────────┴─────────────┴─────────────┘
```

**Clearical Implementation:**
```css
/* Bento grid container */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, auto);
  gap: var(--space-4);
}

/* Standard bento card */
.bento-card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* Dark bento card */
.bento-card--dark {
  background: var(--color-surface-dark);
  border-color: var(--color-border-dark);
  color: var(--color-text-inverse);
}

/* Accent CTA card */
.bento-card--accent {
  background: var(--color-accent);
  border: none;
  color: white;
  grid-row: span 2; /* Tall card */
}

.bento-card--accent .bento-card__icon {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.bento-card__title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
}

.bento-card__description {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.bento-card--dark .bento-card__description {
  color: var(--color-text-tertiary);
}

.bento-card--accent .bento-card__description {
  color: rgba(255, 255, 255, 0.8);
}

/* Avatar stack */
.avatar-stack {
  display: flex;
}

.avatar-stack__item {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  border: 2px solid var(--color-bg-secondary);
  margin-left: -8px;
}

.avatar-stack__item:first-child {
  margin-left: 0;
}

/* Audio wave visualization */
.audio-wave {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 40px;
}

.audio-wave__bar {
  width: 4px;
  background: var(--color-accent);
  border-radius: 2px;
  animation: audioWave 0.8s ease-in-out infinite;
}

@keyframes audioWave {
  0%, 100% { height: 20%; }
  50% { height: 100%; }
}
```

---

### Reference 9: Pixel Icon Set

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Light cream | `--color-bg-primary` |
| Icons | Black pixel art, 20x20 grid | Monochrome icons |
| Style | Geometric, chunky pixels | Developer/retro aesthetic |
| Grid | 4x5 arrangement | Icon showcase |

**Clearical Application**: These pixel icons could complement the JetBrains Mono typography for a cohesive technical aesthetic. Consider creating a pixel icon variant for:
- Navigation icons
- Status indicators
- Decorative elements

**Icon Grid Display:**
```css
.icon-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-8);
  padding: var(--space-8);
}

.icon-item {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
}

.icon-pixel {
  /* Crisp pixel rendering */
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
```

---

### Reference 10: Stytch - Enterprise Identity Platform

**Source Pattern Analysis:**

| Element | Observed Style | Clearical Mapping |
|---------|---------------|-------------------|
| Background | Off-white with subtle grid | `--color-bg-primary` |
| Announcement pill | Yellow bg `~#FFF59D` | **New**: Warning-yellow variant |
| Hero headline | Large serif, mixed weight | **Gap**: Serif font |
| Emphasis text | Bold within headline | `--font-bold` inline |
| Italic emphasis | "enterprise-ready, agent-ready" | Italic variant |
| Dual CTAs | Dark primary + outlined secondary | Button pair |
| Logo bar | Grayscale, horizontal | Trust section |
| Feature grid | 3-column wireframe style | Card grid |
| Code snippets | Dark bg, syntax highlighting | `--color-surface-dark` |
| UI mockups | Minimal wireframe style | Simplified illustrations |
| Section dividers | Horizontal lines | `--color-border-primary` |
| Colored rows | Alternating subtle tints | Row highlighting |

**Yellow Announcement Pill:**
```css
/* Yellow highlight pill (for special announcements) */
.announcement-pill--highlight {
  background: #FFF59D; /* Soft yellow */
  color: var(--color-text-primary);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
```

**Feature Grid with Code:**
```css
/* Feature grid */
.feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--color-border-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl);
  overflow: hidden;
}

.feature-cell {
  background: var(--color-bg-secondary);
  padding: var(--space-6);
}

.feature-cell--wide {
  grid-column: span 2;
}

.feature-cell--tall {
  grid-row: span 2;
}

.feature-cell__title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--font-bold);
  color: var(--color-text-primary);
  margin-bottom: var(--space-2);
}

.feature-cell__description {
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: var(--leading-relaxed);
}

.feature-cell__code {
  background: var(--color-surface-dark);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-top: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-inverse);
  overflow-x: auto;
}

/* Wireframe UI mockup */
.wireframe-ui {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}

.wireframe-row {
  display: flex;
  align-items: center;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border-primary);
}

.wireframe-row:last-child {
  border-bottom: none;
}
```

---

## Typography Gap Analysis

The inspiration images frequently use **serif fonts** for headlines, which Clearical currently lacks. Options:

### Option A: Add Serif Display Font
```css
/* New serif variable (if approved) */
--font-serif: 'Fraunces', 'Playfair Display', 'Georgia', serif;

/* Use for marketing headlines only */
.hero-headline-serif {
  font-family: var(--font-serif);
  font-size: var(--text-5xl);
  font-weight: var(--font-bold);
}
```

### Option B: Enhance Existing DM Sans
DM Sans has a warm, approachable character that works well. Enhance with:
- Bolder weights (800-900) for impact
- Tighter letter-spacing for headlines
- Larger sizes to compensate for lack of serif contrast

```css
/* Enhanced DM Sans headline */
.hero-headline-enhanced {
  font-family: var(--font-display);
  font-size: var(--text-6xl); /* 60px */
  font-weight: var(--font-extrabold); /* 800 */
  letter-spacing: var(--tracking-tighter); /* -0.03em */
  line-height: var(--leading-none); /* 1 */
}
```

### Recommendation
Stick with **Option B** to maintain brand consistency. The inspiration designs work because of the warm cream backgrounds and orange accents - Clearical already has these. A serif font would introduce visual complexity that may conflict with the "technical minimalism" philosophy.

---

## Color Mapping Reference

| Inspiration Color | Hex | Clearical Token | Usage |
|------------------|-----|-----------------|-------|
| Warm cream bg | `#F5F3EE` | `--color-bg-primary: #F2F0ED` | Primary background |
| Pure white | `#FFFFFF` | `--color-bg-secondary` | Cards, elevated |
| Light cream | `#FAF5EE` | `--color-bg-ghost-hover` | Hover states |
| Sand/beige | `#E7DED2` | `--color-bg-tertiary: #E8E6E3` | Inputs, nested |
| Vibrant orange | `#FF6B35` | `--color-accent-light` | Gradients, highlights |
| Blood orange | `#FF4800` | `--color-accent` | Primary CTAs |
| Rich black | `#1A1A1A` | `--color-surface-dark` | Dark elements |
| Coal | `#0D0C0C` | `--color-text-primary` | Primary text |
| Muted brown | `#6B6560` | `--color-text-secondary` | Secondary text |
| Taupe border | `#E4E0DC` | `--color-border-primary` | Borders |
| Yellow highlight | `#FFF59D` | **New**: `--color-highlight` | Announcements |
| Teal/green | `#2D9596` | `--color-success` (similar) | Chat, positive |

---

## Spacing Patterns Observed

| Pattern | Inspiration Size | Clearical Token |
|---------|-----------------|-----------------|
| Card padding | 24-32px | `--space-6` to `--space-8` |
| Section gap | 80-120px | `--space-20` to `--space-24` |
| Element gap | 12-16px | `--space-3` to `--space-4` |
| Button padding X | 16-24px | `--space-4` to `--space-6` |
| Button padding Y | 10-14px | `--space-2-5` to `--space-3` |
| Grid gap | 16-24px | `--space-4` to `--space-6` |
| Icon size | 20-24px | `--space-5` to `--space-6` |
| Border radius (cards) | 16-24px | `--radius-xl` to `--radius-2xl` |
| Border radius (buttons) | 8px or pill | `--radius-md` or `--radius-full` |

---

## Component Checklist for Marketing Pages

### Hero Section
- [ ] Warm cream background (`--color-bg-primary`)
- [ ] Optional: Subtle grid pattern overlay
- [ ] Announcement pill above headline (if needed)
- [ ] Large bold headline (48-60px, `--font-display`)
- [ ] Muted subheadline (`--color-text-secondary`)
- [ ] Primary CTA (orange pill) + Secondary CTA (outline)
- [ ] Product preview or interactive element
- [ ] Generous vertical padding (80-120px)

### Logo Bar / Social Proof
- [ ] Subtle section heading (italic or muted)
- [ ] Grayscale logos for consistency
- [ ] Horizontal layout with generous spacing
- [ ] Optional: Stats or testimonial quote

### Feature Section
- [ ] Section label (uppercase, muted)
- [ ] Bold section headline
- [ ] Tab navigation OR vertical tabs OR bento grid
- [ ] Feature cards with icons
- [ ] Code snippets if relevant (dark bg)
- [ ] Screenshots with subtle shadows

### CTA Section
- [ ] Contrasting background (dark or accent)
- [ ] Clear value proposition headline
- [ ] Single primary CTA button
- [ ] Optional: Supporting text

### Footer
- [ ] Dark background variant
- [ ] Multi-column link layout
- [ ] Newsletter signup
- [ ] Social links
- [ ] Legal links

---

## New Tokens to Add

Based on inspiration analysis, consider adding these to `design-tokens.css`:

```css
/* Marketing-specific additions */

/* Yellow highlight for announcements */
--color-highlight: #FFF59D;
--color-highlight-muted: rgba(255, 245, 157, 0.3);

/* Extended gradient options */
--gradient-accent: linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-light) 100%);
--gradient-dark: linear-gradient(180deg, var(--color-surface-dark) 0%, #0D0C0C 100%);

/* Marketing-specific sizes */
--text-7xl: 4.5rem;  /* 72px - hero headlines */
--text-8xl: 6rem;    /* 96px - display text */

/* Section spacing */
--section-padding-sm: var(--space-12);  /* 48px */
--section-padding-md: var(--space-20);  /* 80px */
--section-padding-lg: var(--space-24);  /* 96px */
```

---

## Implementation Priority

### Phase 1: Foundation
1. Hero section with grid background
2. Announcement pill component
3. Enhanced button variants
4. Logo bar component

### Phase 2: Content Sections
5. Bento grid layout
6. Tab navigation (horizontal + vertical)
7. Feature cards with code
8. Stats/social proof cards

### Phase 3: Polish
9. Floating card effects
10. Marquee animation
11. Avatar stacks
12. Audio wave/progress visualizations

---

*Document updated: January 2026*
*Cross-referenced with: Clearical-Brand.md, design-tokens.css*
