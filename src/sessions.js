const { Client, LocalAuth } = require('whatsapp-web.js')
const fs = require('fs')
const path = require('path')
const sessions = new Map()
const { baseWebhookURL, sessionFolderPath, maxAttachmentSize, setMessagesAsSeen, webVersion, webVersionCacheType, recoverSessions, chromeBin, headless, releaseBrowserLock, enableAutoReply, autoReplyMessage, enableAiAgent } = require('./config')
const { triggerWebhook, waitForNestedObject, checkIfEventisEnabled, sendMessageSeenStatus } = require('./utils')
const { logger } = require('./logger')
const { initWebSocketServer, terminateWebSocketServer, triggerWebSocket } = require('./websocket')
// const { invokeAgent } = require('./aiAgent/autonomous-agent.js') // Old require

// Function to validate if the session is ready
const validateSession = async (sessionId) => {
  try {
    const returnData = { success: false, state: null, message: '' }

    // Session not Connected 😢
    if (!sessions.has(sessionId) || !sessions.get(sessionId)) {
      returnData.message = 'session_not_found'
      return returnData
    }

    const client = sessions.get(sessionId)
    // wait until the client is created
    await waitForNestedObject(client, 'pupPage')
      .catch((err) => { return { success: false, state: null, message: err.message } })

    // Wait for client.pupPage to be evaluable
    let maxRetry = 0
    while (true) {
      try {
        if (client.pupPage.isClosed()) {
          return { success: false, state: null, message: 'browser tab closed' }
        }
        await Promise.race([
          client.pupPage.evaluate('1'),
          new Promise(resolve => setTimeout(resolve, 1000))
        ])
        break
      } catch (error) {
        if (maxRetry === 2) {
          return { success: false, state: null, message: 'session closed' }
        }
        maxRetry++
      }
    }

    const state = await client.getState()
    returnData.state = state
    if (state !== 'CONNECTED') {
      returnData.message = 'session_not_connected'
      return returnData
    }

    // Session Connected 🎉
    returnData.success = true
    returnData.message = 'session_connected'
    return returnData
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to validate session')
    return { success: false, state: null, message: error.message }
  }
}

// Function to handle client session restoration
const restoreSessions = () => {
  try {
    if (!fs.existsSync(sessionFolderPath)) {
      fs.mkdirSync(sessionFolderPath) // Create the session directory if it doesn't exist
    }
    // Read the contents of the folder
    fs.readdir(sessionFolderPath, async (_, files) => {
      // Iterate through the files in the parent folder
      for (const file of files) {
        // Use regular expression to extract the string from the folder name
        const match = file.match(/^session-(.+)$/)
        if (match) {
          const sessionId = match[1]
          logger.warn({ sessionId }, 'existing session detected')
          await setupSession(sessionId)
        }
      }
    })
  } catch (error) {
    logger.error(error, 'Failed to restore sessions')
  }
}

// Setup Session
const setupSession = async (sessionId) => {
  try {
    if (sessions.has(sessionId)) {
      return { success: false, message: `Session already exists for: ${sessionId}`, client: sessions.get(sessionId) }
    }

    // Disable the delete folder from the logout function (will be handled separately)
    const localAuth = new LocalAuth({ clientId: sessionId, dataPath: sessionFolderPath })
    delete localAuth.logout
    localAuth.logout = () => { }

    const clientOptions = {
      puppeteer: {
        executablePath: chromeBin || process.env.CHROME_BIN || '/usr/bin/chromium' || '/usr/bin/chromium-browser',
        headless: headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-zygote',
          '--single-process',
          '--disable-software-rasterizer',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-features=site-per-process',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--safebrowsing-disable-auto-update',
          '--enable-automation',
          '--password-store=basic',
          '--use-mock-keychain',
        ]
      },
      authStrategy: localAuth
    }

    if (webVersion) {
      clientOptions.webVersion = webVersion
      switch (webVersionCacheType.toLowerCase()) {
        case 'local':
          clientOptions.webVersionCache = {
            type: 'local'
          }
          break
        case 'remote':
          clientOptions.webVersionCache = {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/' + webVersion + '.html'
          }
          break
        default:
          clientOptions.webVersionCache = {
            type: 'none'
          }
      }
    }

    const client = new Client(clientOptions)
    if (releaseBrowserLock) {
      // See https://github.com/puppeteer/puppeteer/issues/4860
      const singletonLockPath = path.resolve(path.join(sessionFolderPath, `session-${sessionId}`, 'SingletonLock'))
      const singletonLockExists = await fs.promises.lstat(singletonLockPath).then(() => true).catch(() => false)
      if (singletonLockExists) {
        logger.warn({ sessionId }, 'Browser lock file exists, removing')
        await fs.promises.unlink(singletonLockPath)
      }
    }

    try {
      await client.initialize()
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Initialize error')
      throw error
    }

    initWebSocketServer(sessionId)
    initializeEvents(client, sessionId)

    // Save the session to the Map
    sessions.set(sessionId, client)
    return { success: true, message: 'Session initiated successfully', client }
  } catch (error) {
    return { success: false, message: error.message, client: null }
  }
}

const initializeEvents = (client, sessionId) => {
  // check if the session webhook is overridden
  const sessionWebhook = process.env[sessionId.toUpperCase() + '_WEBHOOK_URL'] || baseWebhookURL

  if (recoverSessions) {
    waitForNestedObject(client, 'pupPage').then(() => {
      const restartSession = async (sessionId) => {
        sessions.delete(sessionId)
        await client.destroy().catch(e => { })
        await setupSession(sessionId)
      }
      client.pupPage.once('close', function () {
        // emitted when the page closes
        logger.warn({ sessionId }, 'Browser page closed. Restoring')
        restartSession(sessionId)
      })
      client.pupPage.once('error', function () {
        // emitted when the page crashes
        logger.warn({ sessionId }, 'Error occurred on browser page. Restoring')
        restartSession(sessionId)
      })
    }).catch(e => { })
  }

  checkIfEventisEnabled('auth_failure')
    .then(_ => {
      client.on('auth_failure', (msg) => {
        triggerWebhook(sessionWebhook, sessionId, 'status', { msg })
        triggerWebSocket(sessionId, 'status', { msg })
      })
    })

  checkIfEventisEnabled('authenticated')
    .then(_ => {
      client.qr = null
      client.on('authenticated', () => {
        triggerWebhook(sessionWebhook, sessionId, 'authenticated')
        triggerWebSocket(sessionId, 'authenticated')
      })
    })

  checkIfEventisEnabled('call')
    .then(_ => {
      client.on('call', async (call) => {
        triggerWebhook(sessionWebhook, sessionId, 'call', { call })
        triggerWebSocket(sessionId, 'call', { call })
      })
    })

  checkIfEventisEnabled('change_state')
    .then(_ => {
      client.on('change_state', state => {
        triggerWebhook(sessionWebhook, sessionId, 'change_state', { state })
        triggerWebSocket(sessionId, 'change_state', { state })
      })
    })

  checkIfEventisEnabled('disconnected')
    .then(_ => {
      client.on('disconnected', (reason) => {
        triggerWebhook(sessionWebhook, sessionId, 'disconnected', { reason })
        triggerWebSocket(sessionId, 'disconnected', { reason })
        // remove session from sessions map
        sessions.delete(sessionId)
        terminateWebSocketServer(sessionId)
      })
    })

  checkIfEventisEnabled('group_join')
    .then(_ => {
      client.on('group_join', (notification) => {
        triggerWebhook(sessionWebhook, sessionId, 'group_join', { notification })
        triggerWebSocket(sessionId, 'group_join', { notification })
      })
    })

  checkIfEventisEnabled('group_leave')
    .then(_ => {
      client.on('group_leave', (notification) => {
        triggerWebhook(sessionWebhook, sessionId, 'group_leave', { notification })
        triggerWebSocket(sessionId, 'group_leave', { notification })
      })
    })

  checkIfEventisEnabled('group_admin_changed')
    .then(_ => {
      client.on('group_admin_changed', (notification) => {
        triggerWebhook(sessionWebhook, sessionId, 'group_admin_changed', { notification })
        triggerWebSocket(sessionId, 'group_admin_changed', { notification })
      })
    })

  checkIfEventisEnabled('group_membership_request')
    .then(_ => {
      client.on('group_membership_request', (notification) => {
        triggerWebhook(sessionWebhook, sessionId, 'group_membership_request', { notification })
        triggerWebSocket(sessionId, 'group_membership_request', { notification })
      })
    })

  checkIfEventisEnabled('group_update')
    .then(_ => {
      client.on('group_update', (notification) => {
        triggerWebhook(sessionWebhook, sessionId, 'group_update', { notification })
        triggerWebSocket(sessionId, 'group_update', { notification })
      })
    })

  checkIfEventisEnabled('loading_screen')
    .then(_ => {
      client.on('loading_screen', (percent, message) => {
        triggerWebhook(sessionWebhook, sessionId, 'loading_screen', { percent, message })
        triggerWebSocket(sessionId, 'loading_screen', { percent, message })
      })
    })

  checkIfEventisEnabled('media_uploaded')
    .then(_ => {
      client.on('media_uploaded', (message) => {
        triggerWebhook(sessionWebhook, sessionId, 'media_uploaded', { message })
        triggerWebSocket(sessionId, 'media_uploaded', { message })
      })
    })

  checkIfEventisEnabled('message')
    .then(_ => {
      client.on('message', async (message) => {
        triggerWebhook(sessionWebhook, sessionId, 'message', { message })
        triggerWebSocket(sessionId, 'message', { message })
        if (message.hasMedia && message._data?.size < maxAttachmentSize) {
          // custom service event
          checkIfEventisEnabled('media').then(_ => {
            message.downloadMedia().then(messageMedia => {
              triggerWebhook(sessionWebhook, sessionId, 'media', { messageMedia, message })
              triggerWebSocket(sessionId, 'media', { messageMedia, message })
            }).catch(error => {
              logger.error({ sessionId, err: error }, 'Failed to download media')
            })
          })
        }
        logger.info('Message received');
        logger.info('In Message');
        if (setMessagesAsSeen) {
          sendMessageSeenStatus(message)
        }

        logger.info('Message received');
        logger.info({ message: message.body }, 'Gonna Reply');
        logger.info({ message: message.fromMe }, 'Checking if from me');
        logger.info({ message: message.type }, 'Checking type');
        // Primary condition: not from self
        if (message.fromMe === false) {
          const chatId = message.from;
          logger.info({ sessionId, chatId, incomingMessageBody: message.body }, 'Incoming message processing started.');

          // Skip group/e2e notifications or status broadcasts for any kind of reply
          if ((message.isGroup && (message.type === 'group_notification' || message.type === 'e2e_notification')) || message.type === 'status_broadcast') {
            logger.info({ sessionId, chatId, messageType: message.type, isGroup: message.isGroup }, 'Skipping reply for group/e2e notification or status broadcast.');
          } else {
            // Message is suitable for a reply, now check AI or standard auto-reply

            if (enableAiAgent) {
              logger.info({ sessionId, chatId }, 'Autonomous AI Agent is enabled. Processing message.');
              try {
                // Dynamically import the ESM agent module
                const { invokeAgent } = await import('./aiAgent/autonomous-agent.mjs');

                const agentInvokeInput = { messages: [{ role: 'user', content: message.body }] };
                const agentInvokeConfig = { configurable: { thread_id: chatId } }; // Use chatId as thread_id

                logger.info({ sessionId, chatId, agentInvokeInput, agentInvokeConfig }, 'Invoking autonomous agent.');

                const agentResponse = await invokeAgent(agentInvokeInput, agentInvokeConfig);
                let aiResponseMessage = null;

                // Parse the response (assuming invokeAgent returns the simplified structure directly)
                if (agentResponse && agentResponse.messages && agentResponse.messages.length > 0) {
                  const lastMessage = agentResponse.messages[agentResponse.messages.length - 1];
                  // Check if the last message is from the AI and has content
                  // For AIMessage instances returned by Langchain createReactAgent with MemorySaver,
                  // the type might be identified via _isAIMessage or instanceof if the class is available
                  // For now, we rely on the structure returned by our invokeAgent (which should be direct .content)
                  // However, the error message indicates the raw response has `content` directly.
                  // Let's assume the last message is the AI's reply for now if it has content.
                  if (lastMessage && typeof lastMessage.content === 'string' && lastMessage.content.trim() !== '') {
                     // A more robust check might be: lastMessage instanceof AIMessage (if AIMessage class is imported and used)
                     // or checking a 'type' or 'role' field if our invokeAgent shapes it that way.
                     // Based on the error log, the error message itself has a direct `content` field.
                     // And successful runs from test script (after MemorySaver was added) also have direct .content on last AIMessage.
                    aiResponseMessage = lastMessage.content;
                  }
                }

                if (aiResponseMessage) {
                  logger.info({ sessionId, chatId, aiResponse: aiResponseMessage }, 'Autonomous AI Agent provided a response. Attempting to send.');
                  await client.sendMessage(chatId, aiResponseMessage, { quotedMessageId: message.id._serialized });
                  logger.info({ sessionId, chatId }, 'Autonomous AI response sent successfully.');
                } else {
                  logger.info({ sessionId, chatId, agentFullResponse: JSON.stringify(agentResponse) }, 'Autonomous AI Agent did not provide a usable message content.');
                  // Optionally, send a generic "I couldn't process that" or fallback to standard auto-reply.
                  // For now, if AI is enabled and doesn't provide a clear response, it does nothing further.
                }
              } catch (aiError) {
                logger.error({ sessionId, chatId, err: aiError.message, stack: aiError.stack }, 'Error processing message with Autonomous AI Agent.');
                // Optional: Fallback to standard auto-reply on AI error?
                // You might want to send a generic error message to the user.
                // await client.sendMessage(chatId, "Sorry, I encountered an error trying to process your request with my advanced AI.", { quotedMessageId: message.id._serialized });
              }
            } else if (enableAutoReply) {
              // AI Agent is not enabled, fall back to standard auto-reply logic
              logger.info({ sessionId, chatId }, 'AI Agent is disabled. Checking standard auto-reply.');
              // (This is the existing auto-reply logic)
              logger.info({ sessionId, chatId, autoReplyMessageContent: autoReplyMessage, originalMsgId: message.id._serialized }, 'Attempting standard auto-reply');
              try {
                await client.sendMessage(chatId, autoReplyMessage, { quotedMessageId: message.id._serialized });
                logger.info({ sessionId, chatId }, 'Standard auto-reply sent successfully');
              } catch (error) {
                logger.error({ sessionId, chatId, err: error.message }, 'Failed to send standard auto-reply');
              }
            }
          }
        }
      })
    })

  checkIfEventisEnabled('message_ack')
    .then(_ => {
      client.on('message_ack', async (message, ack) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_ack', { message, ack })
        triggerWebSocket(sessionId, 'message_ack', { message, ack })
        logger.info('Message received');
        logger.info('In Message Ack');
        if (setMessagesAsSeen) {
          sendMessageSeenStatus(message)
        }
      })
    })

  checkIfEventisEnabled('message_create')
    .then(_ => {
      client.on('message_create', async (message) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_create', { message })
        triggerWebSocket(sessionId, 'message_create', { message })
        logger.info('Message received');
        logger.info('In Message Create');
        if (setMessagesAsSeen) {
          sendMessageSeenStatus(message)
        }
      })
    })

  checkIfEventisEnabled('message_reaction')
    .then(_ => {
      client.on('message_reaction', (reaction) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_reaction', { reaction })
        triggerWebSocket(sessionId, 'message_reaction', { reaction })
      })
    })

  checkIfEventisEnabled('message_edit')
    .then(_ => {
      client.on('message_edit', (message, newBody, prevBody) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_edit', { message, newBody, prevBody })
        triggerWebSocket(sessionId, 'message_edit', { message, newBody, prevBody })
      })
    })

  checkIfEventisEnabled('message_ciphertext')
    .then(_ => {
      client.on('message_ciphertext', (message) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_ciphertext', { message })
        triggerWebSocket(sessionId, 'message_ciphertext', { message })
      })
    })

  checkIfEventisEnabled('message_revoke_everyone')
    .then(_ => {
      client.on('message_revoke_everyone', async (message) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_revoke_everyone', { message })
        triggerWebSocket(sessionId, 'message_revoke_everyone', { message })
      })
    })

  checkIfEventisEnabled('message_revoke_me')
    .then(_ => {
      client.on('message_revoke_me', async (message, revokedMsg) => {
        triggerWebhook(sessionWebhook, sessionId, 'message_revoke_me', { message, revokedMsg })
        triggerWebSocket(sessionId, 'message_revoke_me', { message, revokedMsg })
      })
    })

  client.on('qr', (qr) => {
    // by default QR code is being updated every 20 seconds
    if (client.qrClearTimeout) {
      clearTimeout(client.qrClearTimeout)
    }
    // inject qr code into session
    client.qr = qr
    client.qrClearTimeout = setTimeout(() => {
      if (client.qr) {
        logger.warn({ sessionId }, 'Removing expired QR code')
        client.qr = null
      }
    }, 30000)
    checkIfEventisEnabled('qr')
      .then(_ => {
        triggerWebhook(sessionWebhook, sessionId, 'qr', { qr })
        triggerWebSocket(sessionId, 'qr', { qr })
      })
  })

  checkIfEventisEnabled('ready')
    .then(_ => {
      client.on('ready', () => {
        triggerWebhook(sessionWebhook, sessionId, 'ready')
        triggerWebSocket(sessionId, 'ready')
      })
    })

  checkIfEventisEnabled('contact_changed')
    .then(_ => {
      client.on('contact_changed', async (message, oldId, newId, isContact) => {
        triggerWebhook(sessionWebhook, sessionId, 'contact_changed', { message, oldId, newId, isContact })
        triggerWebSocket(sessionId, 'contact_changed', { message, oldId, newId, isContact })
      })
    })

  checkIfEventisEnabled('chat_removed')
    .then(_ => {
      client.on('chat_removed', async (chat) => {
        triggerWebhook(sessionWebhook, sessionId, 'chat_removed', { chat })
        triggerWebSocket(sessionId, 'chat_removed', { chat })
      })
    })

  checkIfEventisEnabled('chat_archived')
    .then(_ => {
      client.on('chat_archived', async (chat, currState, prevState) => {
        triggerWebhook(sessionWebhook, sessionId, 'chat_archived', { chat, currState, prevState })
        triggerWebSocket(sessionId, 'chat_archived', { chat, currState, prevState })
      })
    })

  checkIfEventisEnabled('unread_count')
    .then(_ => {
      client.on('unread_count', async (chat) => {
        triggerWebhook(sessionWebhook, sessionId, 'unread_count', { chat })
        triggerWebSocket(sessionId, 'unread_count', { chat })
      })
    })

  checkIfEventisEnabled('vote_update')
    .then(_ => {
      client.on('vote_update', async (vote) => {
        triggerWebhook(sessionWebhook, sessionId, 'vote_update', { vote })
        triggerWebSocket(sessionId, 'vote_update', { vote })
      })
    })
}

// Function to delete client session folder
const deleteSessionFolder = async (sessionId) => {
  try {
    const targetDirPath = path.join(sessionFolderPath, `session-${sessionId}`)
    const resolvedTargetDirPath = await fs.promises.realpath(targetDirPath)
    const resolvedSessionPath = await fs.promises.realpath(sessionFolderPath)

    // Ensure the target directory path ends with a path separator
    const safeSessionPath = `${resolvedSessionPath}${path.sep}`

    // Validate the resolved target directory path is a subdirectory of the session folder path
    if (!resolvedTargetDirPath.startsWith(safeSessionPath)) {
      throw new Error('Invalid path: Directory traversal detected')
    }
    await fs.promises.rm(resolvedTargetDirPath, { recursive: true, force: true })
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Folder deletion error')
    throw error
  }
}

// Function to reload client session without removing browser cache
const reloadSession = async (sessionId) => {
  try {
    const client = sessions.get(sessionId)
    if (!client) {
      return
    }
    client.pupPage?.removeAllListeners('close')
    client.pupPage?.removeAllListeners('error')
    try {
      const pages = await client.pupBrowser.pages()
      await Promise.all(pages.map((page) => page.close()))
      await Promise.race([
        client.pupBrowser.close(),
        new Promise(resolve => setTimeout(resolve, 5000))
      ])
    } catch (e) {
      const childProcess = client.pupBrowser.process()
      if (childProcess) {
        childProcess.kill(9)
      }
    }
    sessions.delete(sessionId)
    await setupSession(sessionId)
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to reload session')
    throw error
  }
}

const deleteSession = async (sessionId, validation) => {
  try {
    const client = sessions.get(sessionId)
    if (!client) {
      return
    }
    client.pupPage?.removeAllListeners('close')
    client.pupPage?.removeAllListeners('error')
    try {
      await terminateWebSocketServer(sessionId)
    } catch (error) {
      logger.error({ sessionId, err: error }, 'Failed to terminate WebSocket server')
    }
    if (validation.success) {
      // Client Connected, request logout
      logger.info({ sessionId }, 'Logging out session')
      await client.logout()
    } else if (validation.message === 'session_not_connected') {
      // Client not Connected, request destroy
      logger.info({ sessionId }, 'Destroying session')
      await client.destroy()
    }
    // Wait 10 secs for client.pupBrowser to be disconnected before deleting the folder
    let maxDelay = 0
    while (client.pupBrowser.isConnected() && (maxDelay < 10)) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      maxDelay++
    }
    sessions.delete(sessionId)
    await deleteSessionFolder(sessionId)
  } catch (error) {
    logger.error({ sessionId, err: error }, 'Failed to delete session')
    throw error
  }
}

// Function to handle session flush
const flushSessions = async (deleteOnlyInactive) => {
  try {
    // Read the contents of the sessions folder
    const files = await fs.promises.readdir(sessionFolderPath)
    // Iterate through the files in the parent folder
    for (const file of files) {
      // Use regular expression to extract the string from the folder name
      const match = file.match(/^session-(.+)$/)
      if (match) {
        const sessionId = match[1]
        const validation = await validateSession(sessionId)
        if (!deleteOnlyInactive || !validation.success) {
          await deleteSession(sessionId, validation)
        }
      }
    }
  } catch (error) {
    logger.error(error, 'Failed to flush sessions')
    throw error
  }
}

module.exports = {
  sessions,
  setupSession,
  restoreSessions,
  validateSession,
  deleteSession,
  reloadSession,
  flushSessions
}
