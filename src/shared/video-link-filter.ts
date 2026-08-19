export type VideoLinkFilterMode = 'preview' | 'move';

export interface VideoLinkFilterRequest {
  sourceFolder: string;
  destinationFolder: string;
  linksText: string;
  mode: VideoLinkFilterMode;
  flatten: boolean;
  titleMatch: boolean;
  useYtDlp: boolean;
}

export interface VideoLinkFilterLink {
  id: string;
  title: string;
  url: string;
  platform: string;
}

export interface VideoLinkFilterMove {
  source: string;
  destination: string;
  relativePath: string;
  matchReason: 'ID' | 'TITLE';
  videoId: string;
  link: string;
  platform: string;
  title: string;
  status: 'preview' | 'moved' | 'failed';
  error?: string;
}

export interface VideoLinkFilterResult {
  createdAt: string;
  mode: VideoLinkFilterMode;
  sourceFolder: string;
  destinationFolder: string;
  inputUrls: number;
  recognizedLinks: number;
  scannedVideos: number;
  matchedVideos: number;
  movedVideos: number;
  failed: number;
  warnings: string[];
  moves: VideoLinkFilterMove[];
  unmatchedLinks: VideoLinkFilterLink[];
}
