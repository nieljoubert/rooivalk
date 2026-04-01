# WikimediaService Agent Guidelines

## Overview

The WikimediaService fetches random city images from Wikimedia Commons for use as MOTD image attachments in Discord embeds.

## Key Responsibilities

- Search Wikimedia Commons API for images matching YR_COORDINATES city names
- Filter results to photo MIME types (JPEG, PNG, WebP)
- Download selected image with timeout and size limits
- Return image metadata (title, city name, source URL) and buffer
- Handle API/network failures gracefully

## Core Functionality

### Image Search

- Builds search URL targeting the File namespace (`gsrnamespace=6`)
- Fetches up to 20 results per search term
- Filters out non-photo types (SVGs, PDFs, etc.)
- Picks a random image from filtered results

### Image Download

- Downloads selected image binary data
- Enforces 15-second timeout via `AbortSignal`
- Rejects images larger than 10 MB
- Sanitizes title by stripping `File:` prefix and file extension

## Architecture Notes

- Uses class-based TypeScript with private helper methods
- Integrates with RooivalkService through dependency injection
- Primary image source for MOTD; PeapixService is the fallback

## Integration Points

- **RooivalkService**: Uses WikimediaService as primary MOTD image source
- **YR_COORDINATES**: Reuses weather location names as image search terms

## Testing

- Unit tests in `index.test.ts`
- Mock `fetch` for API and image requests
- Cover success, API errors, MIME filtering, size limits, and network failures

## Error Handling

- Throws on API/network/download failures; callers are responsible for catching
- Returns `null` when no suitable image is found (no pages, no matching MIME types, oversized images)
- Logs warnings for "no results" cases to aid debugging
