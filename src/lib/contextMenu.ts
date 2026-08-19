/**
 * @fileoverview This file manages the creation and handling of browser context menus.
 */

// The different contexts a menu can appear in.
const CONTEXT_TYPES: chrome.contextMenus.ContextType[] = [
  'page',
  'selection',
  'link',
  'image',
  'video',
];

/**
 * Creates the context menus for the extension.
 * This is typically called once, during the extension's installation lifecycle event.
 */
export const createContextMenu = () => {
  // Ensure any old menus are removed before creating new ones.
  chrome.contextMenus.removeAll(() => {
    // Create a parent menu item
    chrome.contextMenus.create({
      id: 'uploadToDriveParent',
      title: 'Google Drive Uploader',
      contexts: CONTEXT_TYPES,
    });

    // Create child menu items
    chrome.contextMenus.create({
      id: 'uploadLinkToDrive',
      parentId: 'uploadToDriveParent',
      title: 'Upload link to Drive',
      contexts: ['link'],
    });

    chrome.contextMenus.create({
      id: 'uploadImageToDrive',
      parentId: 'uploadToDriveParent',
      title: 'Upload image to Drive',
      contexts: ['image'],
    });

    chrome.contextMenus.create({
      id: 'uploadVideoToDrive',
      parentId: 'uploadToDriveParent',
      title: 'Upload video to Drive',
      contexts: ['video'],
    });

    chrome.contextMenus.create({
      id: 'uploadSelectionToDrive',
      parentId: 'uploadToDriveParent',
      title: 'Upload selected text to Drive',
      contexts: ['selection'],
    });
  });
};
