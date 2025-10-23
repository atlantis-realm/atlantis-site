# Atlantis community website - Product requirements document (PRD)

## Project overview

The Atlantis website is a community platform built with SvelteKit that serves as the central outward-facing hub for the Atlantis community.

Everything below needs to be discussed before any implementation is done. Nothing's been decided. Tabs generated a lot of this during a livestream.

## Core pages & features

### Homepage
- **Current state**: Video background with animated "Atlantis" text
- **Suggested features**:
  - Navigation menu
  - Hero section with community highlights
  - Welcome message
  - Upcoming events preview
  - Member count display
  - Quick links to key sections

### Members directory
- **Data source**: Grid API
- **Suggested features**:
  - Paginated member list
  - Search and filtering capabilities
  - Member profiles with roles, join dates, contributions
  - Member badges/achievements
  - Member statistics and activity metrics

### Events
- **Data source**: Grid API
- **Suggested features**:
  - Event listings with categories and tags
  - Filtering by category, date, tags
  - Event details with RSVP functionality
  - Calendar integration
  - Past events archive
  - Event registration system

### Code of conduct
- **Data source**: Grid API (for updates/versioning)
- **Suggested features**:
  - Community guidelines and rules
  - Reporting mechanisms
  - Enforcement policies
  - Version history
  - Interactive reporting form

### AI usage guidelines
- **Data source**: Grid API
- **Suggested features**:
  - AI tool recommendations
  - Usage policies and best practices
  - Community AI projects showcase
  - Guidelines for AI-generated content
  - Tool comparison matrix

### Social links
- **Data source**: Grid API
- **Suggested features**:
  - Links to Discord, Twitter, LinkedIn, GitHub, etc.
  - Social media feed integration
  - Community hashtags and mentions
  - Social media analytics

### Community contacts
- **Data source**: Grid API
- **Suggested features**:
  - Contact form
  - Community moderators list
  - Support channels
  - FAQ section
  - Live chat integration

### Organisation team
- **Data source**: Grid API
- **Suggested features**:
  - Leadership team profiles
  - Organizational structure
  - Contact information for different roles
  - Team member responsibilities
  - Team member bios and photos

### Community resources
- **Data source**: Grid API
- **Suggested features**:
  - Resource library with tags for filtering
  - Categories: Documentation, tools, templates, guides
  - Search functionality
  - Resource ratings and reviews
  - Download tracking
  - Resource submission form

### Achievements system
- **Data source**: Grid API
- **Suggested features**:
  - Various leaderboards (contribution points, streak counters, etc.)
  - Achievement badges and milestones
  - Member ranking system
  - Achievement categories and descriptions
  - Progress tracking for ongoing challenges
  - Achievement showcase gallery

### Slackathons
- **Data source**: TBD (Grid API or separate storage)
- **Suggested features**:
  - Current and past Slackathon events
  - Participant tracking and progress
  - Leaderboards for each Slackathon
  - Event rules and guidelines
  - Registration and participation tracking
  - Real-time progress updates

### 100 day tracker
- **Data source**: TBD (Grid API or separate storage)
- **Suggested features**:
  - Individual progress tracking for 100-day challenges
  - Community-wide progress visualization
  - Streak counters and milestone celebrations
  - Challenge categories and rules
  - Success stories and testimonials
  - Progress sharing and motivation features

### Blog section
- **Data source**: Local markdown files
- **Suggested features**:
  - Paginated blog post listings
  - Category and tag filtering
  - Author information
  - Publication dates
  - Featured posts
  - Svelte components within markdown
  - Syntax highlighting for code blocks
  - Social sharing buttons
  - Related posts suggestions
  - Comment system (optional)
  - Reading time estimation

## File structure

```
src/
├── routes/
│   ├── +page.svelte                 # Homepage
│   ├── +layout.svelte              # Root layout
│   ├── +layout.ts                  # Layout data
│   ├── blog/
│   │   ├── +page.svelte            # Blog listing
│   │   └── [slug]/
│   │       └── +page.svelte        # Individual blog post
│   ├── members/
│   │   └── +page.svelte            # Members directory
│   ├── events/
│   │   ├── +page.svelte            # Events listing
│   │   └── [id]/
│   │       └── +page.svelte        # Event details
│   ├── resources/
│   │   └── +page.svelte            # Resources library
│   ├── achievements/
│   │   └── +page.svelte            # Achievements and leaderboards
│   ├── slackathons/
│   │   ├── +page.svelte            # Slackathons listing
│   │   └── [id]/
│   │       └── +page.svelte        # Individual Slackathon details
│   ├── 100-day-tracker/
│   │   └── +page.svelte            # 100 Day Tracker
│   ├── team/
│   │   └── +page.svelte            # Team page
│   ├── contact/
│   │   └── +page.svelte            # Contact page
│   ├── code-of-conduct/
│   │   └── +page.svelte            # Code of conduct
│   ├── ai-usage/
│   │   └── +page.svelte            # AI usage guidelines
│   └── social/
│       └── +page.svelte            # Social links
├── lib/
│   ├── components/                 # Reusable components
│   ├── utils/                      # Utility functions
│   ├── api/                        # API client for Grid
│   └── types/                      # TypeScript definitions
├── content/                        # Blog posts (markdown files)
└── static/                         # Static assets
```

## API integration specifications

### Grid API endpoints
- TBD

### Data models
```typescript
interface Member {
  id: string;
  name: string;
  role: string;
  joinDate: string;
  avatar?: string;
  bio?: string;
  contributions?: number;
}

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  category: string;
  tags: string[];
  location?: string;
  rsvpCount: number;
}

interface Resource {
  id: string;
  title: string;
  description: string;
  url: string;
  category: string;
  tags: string[];
  rating?: number;
  downloadCount: number;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  points: number;
  icon?: string;
  requirements: string[];
}

interface Leaderboard {
  id: string;
  name: string;
  type: 'points' | 'streak' | 'contributions' | 'events';
  members: LeaderboardEntry[];
  lastUpdated: string;
}

interface LeaderboardEntry {
  memberId: string;
  memberName: string;
  score: number;
  rank: number;
  avatar?: string;
}

interface Slackathon {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  rules: string[];
  participants: SlackathonParticipant[];
  leaderboard: LeaderboardEntry[];
  status: 'upcoming' | 'active' | 'completed';
}

interface SlackathonParticipant {
  memberId: string;
  memberName: string;
  progress: number;
  streak: number;
  lastActivity: string;
}

interface DayTracker {
  id: string;
  memberId: string;
  challengeType: string;
  startDate: string;
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  milestones: Milestone[];
  lastActivity: string;
}

interface Milestone {
  day: number;
  achieved: boolean;
  achievedDate?: string;
  description: string;
}
```

## SEO & performance

### SEO strategy
- Meta tags for each page
- Open Graph and Twitter Card support
- Structured data markup
- Sitemap generation
- RSS feed for blog posts

### Performance targets
- Lighthouse score > 90
- Core Web Vitals compliance
- Image optimization
- Code splitting
- Caching strategies

## Deployment & maintenance

### Deployment
- Static site generation for fast loading
- CDN integration for global performance
- Environment-based configuration
- Automated builds on content updates

### Content management
- Blog posts via Git workflow
- Dynamic content via Grid API
- Version control for all content
- Backup and recovery procedures

## Success metrics

### User engagement
- Page views and session duration
- Blog post read rates
- Resource download counts
- Event RSVP rates

### Technical performance
- Page load times
- Search functionality usage
- Mobile vs desktop usage
- Error rates and uptime

## Future considerations

### Storage decisions (TBD)
- **Slackathons**: Determine if data should be stored in Grid API or separate database
  - Considerations: Real-time updates, participant tracking, complex scoring
- **100 Day Tracker**: Evaluate storage options for individual progress tracking
  - Considerations: Personal data privacy, real-time updates, historical data
- **Achievements**: Confirm Grid API capacity for complex leaderboard calculations
  - Considerations: Performance, caching strategies, real-time updates

### Potential enhancements
- User authentication for member-only content
- Comment system for blog posts
- Newsletter integration
- Multi-language support
- Progressive Web App features
- Integration with additional community tools
- Real-time notifications for achievements and milestones
- Gamification features (badges, levels, rewards)

### Scalability
- API rate limiting considerations
- Content caching strategies
- Database optimization for large member bases
- CDN configuration for global reach
- Real-time data synchronization for achievements and tracking
- Performance optimization for leaderboard calculations

---

*This PRD will be updated as the project evolves and new requirements emerge.*
