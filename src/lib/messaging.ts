// Messaging utilities for popup <-> service worker communication
import type { Message } from './types';

export async function sendMessage<T = any>(message: Message): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

export function addMessageListener(
  callback: (message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean | void
) {
  chrome.runtime.onMessage.addListener(callback);
}

export function removeMessageListener(
  callback: (message: Message, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => boolean | void
) {
  chrome.runtime.onMessage.removeListener(callback);
}
