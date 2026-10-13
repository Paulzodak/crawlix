# Product Specification Document

**Product name:** Document Intelligence (Doc Intel)  
**Document type:** Functional specification  
**Audience:** Product, design, and business stakeholders  

---

## 1. Product overview

Document Intelligence is a product that lets users **upload or paste legal documents**, **get an automatic analysis**, and **manage and share** those analyses. The system detects whether a document is legal, extracts a short title, splits the content into meaningful sections, and produces **highlights** from a **consumer/recipient perspective**: risks, advantages, and compliance points, each with a plain-language description. Users can work as **signed-in users** or **guests**, list and open their documents, rename them, control who can access them, and share documents with other users.

---

## 2. User roles and access

| Role | Description | Capabilities |
|------|-------------|--------------|
| **Guest** | User not signed in; identified by a guest identifier (e.g. from the client). | Can process documents, list and open their own documents, share a document into their list, and update their own documents. Cannot use email-based sharing or view the global user list. |
| **Signed-in user** | User authenticated via email/password, magic link, or social login. | Same as guest, plus: can share documents with other users by email, can be granted access to others’ documents, and can view the list of all users (e.g. for sharing or collaboration). |
| **Document owner** | The user or guest who created or “owns” a document. | Can open, rename, update sharing and visibility, and share the document (create a shared copy for another user). |

Access to a specific document is determined by **ownership**, **visibility**, and **permission** (see Section 5).

---

## 3. Core capabilities

### 3.1 Authentication

- **Sign up (email and password)**  
  User provides email and password to create an account. Password must meet minimum length. Optionally, a verification or magic link can be sent to the email after sign-up.

- **Sign in (email and password)**  
  User signs in with email and password. On success, the user receives a session (and optionally a token for use in headers, e.g. on mobile).

- **Magic link**  
  User requests a sign-in link by email. They receive an email with a time-limited link; opening it signs them in without a password.

- **Social login (Google, GitHub, Apple)**  
  User starts login with a chosen provider and is redirected to that provider, then back to the app. On success, they are signed in and optionally redirected to a specified page (e.g. document list or “new document”).

- **Session and sign out**  
  The product supports checking the current session (e.g. “am I logged in, and who am I?”). The user can sign out, which invalidates the current session.

- **Use on mobile and cross-domain**  
  Session can be established via a cookie (e.g. on web) or via a token sent in a header (e.g. for mobile or when cookies are not sent cross-domain). After login, the client may receive a session token to send in requests when the cookie is not available.

---

### 3.2 Document processing and analysis

- **Submit document for analysis**  
  The user can submit content in one of these ways:
  - **Paste text** (e.g. from a form field).
  - **Upload a file** (supported document types; text is extracted on the server).
  - **Upload an image** (e.g. photo/scan) and use OCR to extract text, then process that text.

- **Legal document check**  
  The system first determines whether the content is a legal document (e.g. contracts, terms, agreements). If it is **not** considered legal, processing stops and the user is informed; no highlights or title are produced.

- **Automatic title**  
  For documents that pass the legal check, the system suggests a short document title (e.g. a few words) based on the content.

- **Chunking and highlights**  
  The document text is split into meaningful sections (chunks). Each section is analyzed to produce **highlights** from the point of view of the **person receiving or signing** the document:
  - **Risks** – what could disadvantage or create liability for them.
  - **Advantages** – what benefits or protects them.
  - **Compliance** – what obligations or rules they must follow.  

  Each highlight includes the **exact snippet from the document** and a **plain-language description** so non-experts can understand it.

- **Progress and completion**  
  While processing runs, the user can poll for progress (e.g. “Analyzing”, “Chunking”, “Summarizing”, “Completed”). When finished, the user can open the document to see the title, the legal check result, and all highlights. Processing can be associated with either a signed-in user or a guest (via a guest identifier).

- **Rate limiting**  
  Document processing is rate-limited per client/user to avoid abuse and ensure fair use.

---

### 3.3 Document management

- **List my documents**  
  The user (or guest) can request a list of documents they own. For signed-in users, the list can also include documents **shared with them** (by email permission). Documents are ordered (e.g. newest first).

- **Open a document**  
  The user can open a document by its identifier. They are allowed to open it only if they are the owner, or the document is shared with them (by email or via a shared copy). For **shared copies** (a document that references another), the user sees the **original document’s content** (highlights, title, etc.) but the copy remains in their list under their ownership.

- **Update a document (owner only)**  
  The owner can update:
  - **Document name** (title).
  - **Permission** – either “no one else” or a list of email addresses that can access the document in addition to the owner.
  - **Visibility** – a visibility level (e.g. 1, 2, or 3) that controls who can discover or access the document (see Section 5).

- **Share a document with another user**  
  A user can create a **shared copy** of an existing document. They provide the source document (e.g. by its ID or job ID). The system creates a new document that:
  - Belongs to the **current user** (or guest).
  - References the original document so that when opened, the **original’s analysis and content** are shown.
  - Is subject to the original document’s sharing and visibility rules (e.g. the current user must be allowed to view the original).  

  If the current user already has a shared copy of that source, the system may return that existing copy instead of creating a duplicate.

---

### 3.4 Document sharing and visibility

- **Permission (by email)**  
  The owner can set:
  - **No sharing** – only the owner can access.
  - **Share by email** – a list of email addresses; those users (when signed in with that email) can also access the document.

- **Visibility**  
  Each document has a visibility level (e.g. 1, 2, or 3) that defines who can access it when they are **not** the owner and **not** in the permission list. For example:
  - One level might mean “only owner and permitted emails”.
  - Another might mean “anyone with the link or who is explicitly permitted”.
  - Another might mean “fully private; no one else”.  

  Exact behavior of each level is defined in business rules (Section 5).

- **Shared copies**  
  When a user “shares” a document (creates a shared copy), they get a new document in their list that points to the original. Opening it shows the original’s analysis. Access to the original is still enforced (visibility and permission).

---

### 3.5 Text cleaning (OCR cleanup)

- **Clean raw text**  
  The user can send raw text (e.g. from OCR or copy-paste) and receive a **cleaned version**: corrected spacing, obvious OCR errors fixed, and irrelevant noise removed, while keeping meaning and structure. This is a standalone utility (e.g. for use before pasting into the main document flow or in an OCR workflow).

---

### 3.6 User listing

- **List all users**  
  Signed-in users can request a list of all users (e.g. to choose who to share with or to display in the UI). Only authenticated users can use this; guests cannot. The list exposes only safe, non-sensitive fields (e.g. id, email, username, profile image, verification and timestamps); passwords are never returned.

---

## 4. Main user flows

1. **Guest processes a document**  
   Guest provides a guest ID (e.g. from the client). They paste or upload a document, submit for processing, poll for progress, then open the result to see legal check, title, and highlights. They can rename the document, change permission/visibility, and create a shared copy for themselves (so it stays in their list after they sign in later, if the product supports that).

2. **User signs up and processes a document**  
   User signs up with email/password (or magic link / social). They sign in, then submit a document (paste or upload). They see progress and then the analysis. They can list documents, open any they own or that are shared with them, and update name/permission/visibility. They can share a document (create a shared copy) for themselves or for another user (if allowed by visibility and permission).

3. **User opens a shared document**  
   User has a document in their list that is a “shared copy” of someone else’s document. They open it; the system shows the **original** document’s content (highlights, title, etc.) if they are allowed by the original’s visibility and permission. If not allowed, access is denied.

4. **User shares with another by email**  
   Owner adds the other user’s email to the document’s permission list and sets visibility appropriately. The other user, when signed in with that email, sees the document in their list (or can access it by ID) and can open it.

5. **Mobile or cross-domain usage**  
   User signs in on a mobile app or a frontend on a different domain. They receive a session token in the response (or in the redirect URL after social login). The client sends this token in a header on each request. The product treats this the same as a cookie-based session for all capabilities above.

---

## 5. Business rules and validation

- **Document processing**  
  - Every processing job must be tied to either a signed-in user or a guest (exactly one).  
  - If the content is not classified as a legal document, no title or highlights are generated; the user is only informed of the legal check result.  
  - Processing is rate-limited to prevent abuse.

- **Document access**  
  - A user or guest can open a document only if:  
    - they are the owner, or  
    - they are in the document’s permission list (by email), or  
    - the document is a shared copy they own and they are allowed to access the original (visibility and permission).  
  - Visibility levels define whether someone who is not the owner and not in the permission list can access the document (e.g. “private” vs “link-only” vs “only permitted emails”).

- **Document updates**  
  - Only the **owner** of a document can update its name, permission list, or visibility.

- **Sharing (creating a shared copy)**  
  - The user creating the shared copy must be allowed to access the source document (visibility and permission).  
  - The new document is owned by the current user or guest.  
  - If the current user/guest already has a shared copy of the same source, the system may return that copy instead of creating another.

- **Authentication**  
  - Sign-up requires a valid email and a password that meets minimum length.  
  - Magic link and social flows are time-limited or provider-limited as configured.  
  - Session can be provided by cookie or by token in a header for compatibility with mobile and cross-domain clients.

- **User list**  
  - Only signed-in users can request the list of users. Passwords and other sensitive data are never returned.

---

## 6. Out of scope (for this specification)

- Detailed UI/UX and wireframes.  
- Technical architecture, APIs, or infrastructure.  
- Exact visibility level semantics (e.g. numeric values 1/2/3) can be refined in a separate business rules doc.  
- Chat or Q&A over the document (if present in the codebase, it is not specified here).  
- Export of highlights (e.g. PDF/Word) – noted as a possible future feature in notes but not a current requirement in this spec.

---

## 7. Success criteria (functional)

- Users and guests can submit documents (text, file, or image/OCR) and receive a legal check, title, and consumer-focused highlights (risks, advantages, compliance) with plain-language descriptions.  
- Signed-in users and guests can list, open, rename, and control sharing and visibility of their documents.  
- Signed-in users can share documents by email and create shared copies; access is enforced by visibility and permission.  
- Users can authenticate via email/password, magic link, and social providers, and can use the product on mobile or cross-domain via token-based session.  
- Only document owners can update a document’s metadata and sharing settings; only signed-in users can view the user list.

---

*This document describes **what** the product does from a user and business perspective, not **how** it is implemented.*
