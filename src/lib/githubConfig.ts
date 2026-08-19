// GitHub Actions Backend Configuration
// Replace with your values after setting up the GitHub Actions workflow

export interface GitHubConfig {
  owner: string;              // Your GitHub username or org
  repo: string;               // Your workflow repository name
  token: string;              // Fine-grained PAT (Actions: R/W, Contents: R)
  defaultAccountKey: string;  // Default secret name for Drive refresh token
  defaultParentKey?: string;  // Optional default folder secret name
  enabled: boolean;           // Enable/disable GitHub Actions backend
}

// Default configuration - update these values
export const DEFAULT_GITHUB_CONFIG: GitHubConfig = {
  owner: '',                              // e.g., 'your-username'
  repo: '',                               // e.g., 'drive-uploader-actions'
  token: '',                              // Your fine-grained PAT
  defaultAccountKey: 'DRIVE_REFRESH_TOKEN_MAIN',
  defaultParentKey: 'DRIVE_PARENT_FOLDER_MAIN',
  enabled: false
};

// Account mapping: UI name → GitHub secret name
export interface GitHubAccount {
  id: string;                 // Unique ID for UI
  name: string;               // Display name
  email?: string;             // Account email (if known)
  secretKey: string;          // GitHub secret name (e.g., DRIVE_REFRESH_TOKEN_MAIN)
  folderKey?: string;         // Optional folder secret (e.g., DRIVE_PARENT_FOLDER_MAIN)
}

// Default accounts - add your accounts here
export const DEFAULT_GITHUB_ACCOUNTS: GitHubAccount[] = [
  {
    id: 'main',
    name: 'Main Account',
    secretKey: 'DRIVE_REFRESH_TOKEN_MAIN',
    folderKey: 'DRIVE_PARENT_FOLDER_MAIN'
  }
  // Add more accounts:
  // {
  //   id: 'work',
  //   name: 'Work Account',
  //   email: 'work@company.com',
  //   secretKey: 'DRIVE_REFRESH_TOKEN_WORK',
  //   folderKey: 'DRIVE_PARENT_FOLDER_WORK'
  // }
];
