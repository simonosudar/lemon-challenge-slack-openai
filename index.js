const express = require('express');
const { WebClient } = require('@slack/web-api');
const bodyParser = require('body-parser');
const { OpenAIApi, Configuration } = require('openai');
const GPT3TokenizerImport = require('gpt3-tokenizer');
require('dotenv').config();

const GPT3Tokenizer = typeof GPT3TokenizerImport === "function" ? GPT3TokenizerImport : GPT3TokenizerImport.default;
const tokenizer = new GPT3Tokenizer({ type: 'gpt3' });

const app = express();
const port = process.env.PORT || 3000;
const slack_token = process.env.SLACK_TOKEN;
const slack = new WebClient(slack_token);
const configuration = new Configuration({ apiKey: process.env.OPENAI_TOKEN });
const openai = new OpenAIApi(configuration);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

async function fetchSlackConversation(timePeriod = 'day') {
    let oldest;

        switch (timePeriod) {
            case '15 minutes':
                oldest = Math.floor((Date.now() - 15 * 60 * 1000) / 1000);
                break;
            case 'hour':
                oldest = Math.floor((Date.now() - 60 * 60 * 1000) / 1000);
                break;
            case 'day':
            default:
                oldest = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
                break;
        }

    let result;
    try {
        result = await slack.conversations.history({
            channel: process.env.CHANNEL_ID,
            limit: 100,
            oldest: oldest
        });
    } catch (error) {
        console.error('Failed to fetch Slack messages:', error);
        throw error;
    }

    let conversationMessages = [];
    for (const message of result.messages.reverse()) {
        if (!message.subtype || (message.subtype !== 'channel_join' && message.subtype !== 'group_join') && message.user !== "LimaLimBot") {
            let userName = '';
            try {
                const userInfo = await slack.users.info({ user: message.user });
                userName = userInfo.user.real_name || userInfo.user.name;
            } catch (error) {
                console.error('Failed to fetch user info:', error);
                userName = 'Unknown User';
            }
            
            conversationMessages.push(userName + ': ' + message.text);
        }
    }
    console.log(conversationMessages);
    conversationMessages.pop()

    if (result.messages.length > 0) {
        lastSummaryTimestamp = result.messages[result.messages.length - 1].ts;
    }

    return {
        content: conversationMessages.join('\n')
    };
}

async function generateSummary(conversation) {
    const tokens = tokenizer.encode(conversation).text.length;
    if (tokens > 4096) {
        console.error('Conversation is too long:', tokens, 'tokens');
        throw new Error('Conversation is too long for GPT-3.5-turbo model');
    }

    const messages = [
        { role: "user", content: "Resume la siguiente conversación: " + conversation },
    ];

    const apiRequestBody = {
        model: 'gpt-3.5-turbo',
        messages: messages,
        temperature: 0.6,
    };

    try {
        const result = await openai.createChatCompletion(apiRequestBody);
        return result.data.choices[0].message.content;
    } catch (error) {
        console.error('Failed to generate summary:', error);
        throw error;
    }
}

async function processEvent(event) {
    if ((event.type === 'app_mention' || event.type === 'message') && event.user !== process.env.BOT_USER_ID) {
        let messageText = event.text;
        let channelId = event.channel;

        if (messageText.includes('!summary')) {
            let timePeriodMatch = messageText.match(/\b(15 minutes|hour|day)\b/);
            let timePeriod = timePeriodMatch ? timePeriodMatch[0] : 'day';

            console.log("Processing event: ", event);
            let slackMessages = await fetchSlackConversation(timePeriod);
            console.log(slackMessages);

            let summary = await generateSummary(slackMessages.content)
            await slack.chat.postEphemeral({
                token: slack_token,
                user: event.user,
                channel: channelId,
                text: `Resumen del siguiente periodo de tiempo ${timePeriod}: \n\n 🍋 ${summary}`
            });
        }
    }
}

app.post('/events', async (req, res) => {
    const body = req.body;
    if (body.type === 'event_callback') {
        res.sendStatus(200);
        processEvent(body.event);
    } else {
        res.sendStatus(500);
    }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
