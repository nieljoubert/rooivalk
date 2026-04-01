# PeapixService Agent Guidelines

## Overview

The PeapixService fetches a daily Bing image from the Peapix feed and returns a downloadable image payload plus attribution metadata for Discord embeds.

## Key Responsibilities

- Fetch feed data from `https://peapix.com/bing/feed`
- Parse and validate feed response shape
- Download the selected image bytes
- Return image metadata (title, copyright, page URL)
- Handle feed/image fetch failures gracefully

## Core Functionality

### Feed Fetching

- Builds feed URL query params (`country`, `n`)
- Requests feed payload and validates expected item fields
- Uses `fullUrl` for highest quality image asset

### Image Payload Creation

- Downloads selected image as binary data
- Converts response to `Buffer`
- Returns strongly typed image object for consumers

## Architecture Notes

- Uses class-based TypeScript with private helper methods
- Integrates with RooivalkService through dependency injection
- Keeps API parsing logic isolated from business logic

## Integration Points

- **RooivalkService**: Uses PeapixService for MOTD image attachment and attribution footer
- **Shared types**: Feed response typing in `src/types.ts`

## Testing

- Unit tests in `index.test.ts`
- Mock `fetch` for feed and image requests
- Cover success, invalid payloads, and failure fallbacks

## Error Handling

- Throws on API/network/download failures; callers are responsible for catching
- Returns `null` when no feed item is available or validation fails
- Logs warnings for feed validation failures to aid debugging
