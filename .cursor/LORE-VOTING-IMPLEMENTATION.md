# Lore Voting System - Implementation Guide

A 365-question voting system with daily result disclosure, Discord/Twitch authentication, and admin approval workflow.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SvelteKit Static Site                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Voting Page │  │ Results Page│  │ Admin Panel             │  │
│  │ /lore/vote  │  │ /lore/vote  │  │ /lore/admin             │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Appwrite (Self-hosted on Coolify)               │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐ │
│  │   Auth   │  │   Database   │  │   Scheduled Functions      │ │
│  │ Discord  │  │  Collections │  │  Daily result aggregation  │ │
│  │ Twitch   │  │              │  │                            │ │
│  └──────────┘  └──────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Appwrite Setup on Coolify

### 1.1 Deploy Appwrite
- Add Appwrite to Coolify using their Docker Compose template
- Appwrite requires: `appwrite`, `mariadb`, `redis`, `influxdb` containers
- Set the `_APP_DOMAIN` environment variable to your domain
- Configure SSL through Coolify's built-in SSL management

### 1.2 Initial Appwrite Configuration
1. Access Appwrite console at your domain
2. Create a new project (e.g., "atlantis-lore")
3. Note the **Project ID** (this is safe to commit to the repo)
4. Generate an **API Key** with appropriate scopes (keep this secret, only in Coolify env vars)

### 1.3 Enable OAuth Providers

**Discord:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application → OAuth2 → Add redirect: `https://[YOUR_APPWRITE_DOMAIN]/v1/account/sessions/oauth2/callback/discord/[PROJECT_ID]`
3. Copy Client ID and Client Secret
4. In Appwrite Console: Auth → Settings → Discord → Enable and paste credentials

**Twitch:**
1. Go to [Twitch Developer Console](https://dev.twitch.tv/console)
2. Register new application → Add redirect: `https://[YOUR_APPWRITE_DOMAIN]/v1/account/sessions/oauth2/callback/twitch/[PROJECT_ID]`
3. Copy Client ID and Client Secret
4. In Appwrite Console: Auth → Settings → Twitch → Enable and paste credentials

### 1.4 Create Database Collections

Create a database called `lore` with these collections:

**Collection: `users_meta`**
| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| userId | string (36) | Yes | Appwrite user ID |
| approved | boolean | Yes | Default: false |
| isAdmin | boolean | Yes | Default: false |
| displayName | string (100) | Yes | From OAuth |
| avatarUrl | string (2000) | No | From OAuth |
| provider | string (20) | Yes | "discord" or "twitch" |

Indexes: `userId` (unique)

**Collection: `questions`**
| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| dayNumber | integer | Yes | 1-365 |
| questionText | string (1000) | Yes | The question |
| options | string (5000) | Yes | JSON array: `[{id, text}]` |
| allowMultiSelect | boolean | Yes | Checkboxes vs radio |
| allowComments | boolean | Yes | Enable comments |

Indexes: `dayNumber` (unique)

**Collection: `votes`**
| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| questionId | string (36) | Yes | Reference to question |
| userId | string (36) | Yes | Who voted |
| selectedOptions | string (500) | Yes | JSON array of option IDs |
| updatedAt | datetime | Yes | Last vote change |

Indexes: `questionId_userId` (unique, composite)

**Collection: `comments`**
| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| questionId | string (36) | Yes | Reference to question |
| userId | string (36) | Yes | Who commented |
| text | string (2000) | Yes | Comment content |
| createdAt | datetime | Yes | When posted |

Indexes: `questionId`, `userId`

**Collection: `daily_results`**
| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| date | string (10) | Yes | YYYY-MM-DD format |
| results | string (1000000) | Yes | JSON blob with all results |
| disclosedAt | datetime | Yes | When generated |

Indexes: `date` (unique)

### 1.5 Set Collection Permissions

| Collection | Create | Read | Update | Delete |
|------------|--------|------|--------|--------|
| users_meta | Any (on first login) | Users: own doc; Admins: all | Admins only | Admins only |
| questions | Admins only | Any authenticated | Admins only | Admins only |
| votes | Approved users only | Server/Functions only | Doc owner only | None |
| comments | Approved users only | Server/Functions only | None | Admins only |
| daily_results | Functions only | Any authenticated | Functions only | None |

Use Appwrite's permission system with:
- `Role.user([userId])` for user-specific access
- `Role.label('admin')` for admin access (set labels via Appwrite Console or API)
- `Role.any()` for public read access

---

## Phase 2: SvelteKit Auth Integration

### 2.1 Install Dependencies
```bash
npm install appwrite
```

### 2.2 Create Appwrite Client
Create `src/lib/appwrite.ts`:
- Initialize Appwrite Client with endpoint and project ID
- Export `account`, `databases` instances
- Project ID can be hardcoded (it's public)
- Endpoint should point to your Appwrite instance

### 2.3 Create Auth Store
Create `src/lib/stores/auth.svelte.ts`:
- Use Svelte 5 runes (`$state`, `$derived`)
- Track: current user, user metadata (approved, isAdmin), loading state
- Methods: login (Discord/Twitch), logout, checkSession
- On login success, create/update `users_meta` document

### 2.4 Create OAuth Callback Handler
Create `src/routes/lore/vote/callback/+page.svelte`:
- Appwrite redirects here after OAuth
- Parse the session from URL parameters
- Redirect to voting page or show error

### 2.5 Disable Prerendering for Auth Pages
Create `+page.ts` files with `export const prerender = false` for:
- `/lore/vote`
- `/lore/vote/callback`
- `/lore/admin`

---

## Phase 3: Admin Panel

### 3.1 Create Admin Route
Create `src/routes/lore/admin/+page.svelte`:
- Check if current user has `isAdmin: true` in their `users_meta`
- Redirect non-admins to voting page

### 3.2 Pending Users List
- Query `users_meta` where `approved = false`
- Display: avatar, display name, provider, registration date
- Actions: Approve, Deny (delete)

### 3.3 Approved Users Management
- List all approved users
- Option to revoke approval
- Option to grant/revoke admin status

### 3.4 Set First Admin
Initially, you'll need to manually set the first admin:
1. Log in with your Discord/Twitch account
2. In Appwrite Console, find your user document in `users_meta`
3. Set `approved: true` and `isAdmin: true`
4. From then on, you can manage admins via the admin panel

---

## Phase 4: Voting Interface

### 4.1 Create Voting Page
Create `src/routes/lore/vote/+page.svelte`:
- Gate behind authentication (show login buttons if not logged in)
- Show "pending approval" message if user not approved
- Load questions from Appwrite

### 4.2 Question Components
Create `src/lib/components/QuestionCard.svelte`:
- Props: question data, current user's vote (if any)
- Render radio buttons or checkboxes based on `allowMultiSelect`
- Optional comment textarea if `allowComments` is true
- Submit button to save/update vote

### 4.3 Vote Submission Logic
- Use upsert pattern: check if vote exists for this question+user
- If exists: update `selectedOptions` and `updatedAt`
- If not: create new vote document
- Show success/error feedback

### 4.4 Question Navigation
Options for displaying 365 questions:
- **Paginated list**: 10-20 questions per page
- **Day selector**: Dropdown or calendar to jump to specific day
- **Category view**: If questions are grouped thematically
- **Progress indicator**: Show how many questions user has answered

---

## Phase 5: Daily Result Disclosure

### 5.1 Create Appwrite Function
In Appwrite Console: Functions → Create Function
- Runtime: Node.js 18+
- Schedule: CRON expression for your preferred time (e.g., `0 0 * * *` for midnight UTC)

### 5.2 Function Logic
The function should:
1. Get yesterday's date (or today's, depending on your disclosure logic)
2. Query all votes
3. Query all comments
4. Query all questions
5. For each question, aggregate:
   - Vote counts per option
   - List of user IDs who voted for each option
   - All comments with user IDs
6. Create/update document in `daily_results` collection
7. Include user display names (join with `users_meta`)

### 5.3 Result Data Structure
The `results` JSON blob structure:
```
{
  "questions": {
    "[questionId]": {
      "questionText": "...",
      "options": {
        "[optionId]": {
          "text": "...",
          "count": 42,
          "voters": [
            { "userId": "...", "displayName": "...", "avatarUrl": "..." }
          ]
        }
      },
      "comments": [
        { "userId": "...", "displayName": "...", "avatarUrl": "...", "text": "...", "createdAt": "..." }
      ]
    }
  },
  "totalVoters": 156,
  "generatedAt": "2025-01-15T00:00:00Z"
}
```

### 5.4 Results Display Component
Create `src/lib/components/VoteResults.svelte`:
- Fetch latest `daily_results` document
- Show vote counts and percentages per option
- Collapsible/expandable sections for:
  - Who voted for each option (avatars + names)
  - Comments (avatars + names + text)
- Clear indication of disclosure time

---

## Phase 6: Question Seeding

### 6.1 Option A: Admin UI
Add to admin panel:
- Form to create/edit questions
- Bulk import from JSON/CSV

### 6.2 Option B: Seed Script
Create a one-time script that:
- Reads questions from a JSON file
- Uses Appwrite Server SDK with API key
- Creates all 365 question documents
- Run locally or as a deployment step

### 6.3 Question Data Format
Prepare questions as JSON:
```
[
  {
    "dayNumber": 1,
    "questionText": "What is your favorite...",
    "options": [
      { "id": "a", "text": "Option A" },
      { "id": "b", "text": "Option B" }
    ],
    "allowMultiSelect": false,
    "allowComments": true
  }
]
```

---

## Testing Checklist

### Phase 1 Complete When:
- [ ] Appwrite is accessible at your domain
- [ ] Can create a test user via Console
- [ ] All collections exist with correct attributes
- [ ] OAuth providers show as enabled

### Phase 2 Complete When:
- [ ] "Login with Discord" button works
- [ ] "Login with Twitch" button works
- [ ] User document created in `users_meta` on first login
- [ ] Session persists on page refresh
- [ ] Logout clears session

### Phase 3 Complete When:
- [ ] Non-admins cannot access /lore/admin
- [ ] Admin can see pending users
- [ ] Admin can approve users
- [ ] Approved status persists

### Phase 4 Complete When:
- [ ] Questions load on voting page
- [ ] Can submit votes (approved users only)
- [ ] Can change votes
- [ ] Comments save correctly
- [ ] Unapproved users see "pending" message

### Phase 5 Complete When:
- [ ] Scheduled function runs at correct time
- [ ] `daily_results` document created
- [ ] Results page shows aggregated data
- [ ] Voter/commenter lists expand correctly

---

## Environment Variables

### Coolify (for SvelteKit):
```
PUBLIC_APPWRITE_ENDPOINT=https://your-appwrite-domain.com/v1
PUBLIC_APPWRITE_PROJECT_ID=your-project-id
```

### Appwrite Function (for daily aggregation):
```
APPWRITE_ENDPOINT=https://your-appwrite-domain.com/v1
APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-server-api-key
```

---

## Security Notes

- **Project ID is public** - safe to commit
- **API Keys are secret** - only in Coolify/Appwrite env vars, never in code
- **Votes/Comments are server-read only** - clients can only write, not read raw data
- **Results are public** - anyone logged in can see disclosed results
- **Admin checks happen server-side** - via Appwrite permissions, not just client-side

---

## File Structure Summary

```
src/
├── lib/
│   ├── appwrite.ts                    # Appwrite client setup
│   ├── stores/
│   │   └── auth.svelte.ts             # Auth state with runes
│   └── components/
│       ├── QuestionCard.svelte        # Single question voting UI
│       ├── VoteResults.svelte         # Disclosed results display
│       ├── LoginButton.svelte         # Discord/Twitch login buttons
│       └── PendingApproval.svelte     # "Awaiting approval" message
├── routes/
│   └── lore/
│       ├── vote/
│       │   ├── +page.svelte           # Main voting interface
│       │   ├── +page.ts               # prerender = false
│       │   └── callback/
│       │       ├── +page.svelte       # OAuth callback handler
│       │       └── +page.ts           # prerender = false
│       ├── admin/
│       │   ├── +page.svelte           # Admin approval panel
│       │   └── +page.ts               # prerender = false
│       └── results/
│           ├── +page.svelte           # Public results view
│           └── +page.ts               # prerender = false
```

---

*Last updated: December 2024*

