# Data Guardian - Professional Design System

## 🎨 Color Palette

### Primary Colors
```css
--primary-blue: #0ea5e9        /* Sky Blue - Primary actions */
--primary-blue-dark: #0284c7   /* Darker Blue - Hover states */
--accent-cyan: #06b6d4         /* Cyan - Accents */
--accent-purple: #8b5cf6       /* Purple - Secondary accents */
```

### Background Colors
```css
--dark-bg: #0f172a            /* Primary dark background */
--darker-bg: #020617          /* Deeper dark background */
--card-bg: rgba(15, 23, 42, 0.8)  /* Card backgrounds */
```

### Text Colors
```css
--text-primary: #f8fafc       /* Primary text - White */
--text-secondary: #cbd5e1     /* Secondary text - Light Gray */
--text-muted: #64748b         /* Muted text - Slate Gray */
```

### Semantic Colors
```css
--success: #10b981            /* Green - Success states */
--warning: #f59e0b            /* Orange - Warning states */
--danger: #ef4444             /* Red - Error/Danger states */
```

### Border & Dividers
```css
--border-color: rgba(148, 163, 184, 0.1)  /* Subtle borders */
```

---

## 📝 Typography

### Font Family
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Font Weights
- Light: 300
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700
- Extrabold: 800

### Heading Sizes
```css
h1: 48px (font-weight: 800)
h2: 40px (font-weight: 800)
h3: 28px (font-weight: 700)
h4: 24px (font-weight: 700)
h5: 20px (font-weight: 600)
```

### Body Text
```css
Base: 16px (font-weight: 400)
Small: 14px
Extra Small: 13px
Tiny: 12px
```

---

## 🎯 Spacing Scale

```css
xs:  8px
sm:  12px
md:  16px
lg:  20px
xl:  24px
2xl: 32px
3xl: 40px
4xl: 48px
```

---

## 🔲 Border Radius

```css
Small:   8px   /* Small elements */
Medium:  12px  /* Buttons, inputs */
Large:   16px  /* Cards, containers */
XLarge:  20px  /* Large cards */
XXLarge: 24px  /* Hero cards */
Round:   50%   /* Circular elements */
```

---

## 🎭 Shadows

### Card Shadows
```css
/* Standard Card */
box-shadow: 
  0 20px 60px rgba(0, 0, 0, 0.5),
  0 0 0 1px rgba(148, 163, 184, 0.05);

/* Elevated Card */
box-shadow: 
  0 25px 50px -12px rgba(0, 0, 0, 0.6),
  0 0 80px rgba(14, 165, 233, 0.1);
```

### Button Shadows
```css
/* Default */
box-shadow: 0 8px 20px rgba(14, 165, 233, 0.3);

/* Hover */
box-shadow: 0 12px 30px rgba(14, 165, 233, 0.4);
```

---

## 🎬 Animations

### Timing Functions
```css
/* Standard */
transition: all 0.3s ease;

/* Smooth */
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

/* Bouncy */
animation: cardAppear 0.6s cubic-bezier(0.16, 1, 0.3, 1);
```

### Common Animations
```css
/* Fade In */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Slide Up */
@keyframes slideUp {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Hover Lift */
.element:hover {
  transform: translateY(-2px);
}
```

---

## 🎨 Gradient Patterns

### Primary Gradient (Blue to Cyan)
```css
background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%);
```

### Text Gradient (Blue to Purple)
```css
background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #8b5cf6 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
background-clip: text;
```

### Background Gradient (Dark)
```css
background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
```

### Card Gradient
```css
background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
```

---

## 🪟 Glassmorphism

### Standard Glass Card
```css
background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
backdrop-filter: blur(20px);
border: 1px solid rgba(148, 163, 184, 0.1);
border-radius: 24px;
```

### Intense Glass Effect
```css
backdrop-filter: blur(40px);
background: rgba(15, 23, 42, 0.8);
```

---

## 🔘 Button Styles

### Primary Button
```css
.btn-primary {
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: white;
  padding: 14px 28px;
  border-radius: 12px;
  font-weight: 600;
  box-shadow: 0 8px 20px rgba(14, 165, 233, 0.3);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 30px rgba(14, 165, 233, 0.4);
}
```

### Success Button
```css
.btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
}
```

### Secondary Button
```css
.btn-secondary {
  background: linear-gradient(135deg, #475569 0%, #334155 100%);
  box-shadow: 0 8px 20px rgba(71, 85, 105, 0.3);
}
```

---

## 📦 Form Elements

### Input Fields
```css
.form-input {
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 12px;
  padding: 14px 16px;
  color: white;
  font-size: 15px;
  transition: all 0.3s ease;
}

.form-input:focus {
  border-color: #0ea5e9;
  background: rgba(15, 23, 42, 0.7);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
  outline: none;
}
```

---

## 🌐 Background Effects

### Grid Pattern
```css
background-image: 
  linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px),
  linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px);
background-size: 50px 50px;
```

### Radial Glow
```css
background: 
  radial-gradient(circle at 20% 30%, rgba(14, 165, 233, 0.1) 0%, transparent 50%),
  radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.1) 0%, transparent 50%);
```

---

## 📱 Responsive Breakpoints

```css
/* Desktop */
@media (min-width: 1200px) { }

/* Tablet */
@media (max-width: 992px) { }

/* Mobile */
@media (max-width: 768px) { }

/* Small Mobile */
@media (max-width: 480px) { }
```

---

## ✨ Usage Examples

### Hero Section
```css
.hero-section {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}

.hero-section::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 20% 50%, rgba(14, 165, 233, 0.1) 0%, transparent 50%);
}

.hero-section::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: 
    linear-gradient(rgba(148, 163, 184, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.03) 1px, transparent 1px);
  background-size: 50px 50px;
}
```

### Glass Card
```css
.glass-card {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 24px;
  padding: 40px;
  box-shadow: 
    0 20px 60px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(148, 163, 184, 0.05);
}
```

---

## 🎯 Design Principles

1. **Consistency**: Use the same spacing, colors, and patterns throughout
2. **Hierarchy**: Clear visual hierarchy with size, weight, and color
3. **Contrast**: Ensure sufficient contrast for readability
4. **Simplicity**: Clean, uncluttered interfaces
5. **Performance**: Smooth 60fps animations
6. **Accessibility**: WCAG 2.1 AA compliant
7. **Professional**: Enterprise-grade visual design

---

## 🚀 Quick Start

1. Import Inter font from Google Fonts
2. Set CSS variables in `:root`
3. Apply dark background to body
4. Use glassmorphic cards for content
5. Apply gradient buttons for CTAs
6. Add subtle animations for interactions
7. Maintain consistent spacing and sizing

---

**Remember**: This is a professional, tech-focused design system. Avoid bright colors, playful fonts, and emoji-style elements. Keep it clean, sophisticated, and trustworthy.
