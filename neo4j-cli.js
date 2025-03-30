#!/usr/bin/env node

import { program } from 'commander';
import inquirer from 'inquirer';
import neo4j from 'neo4j-driver';
import chalk from 'chalk';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();
const SECRET_KEY = process.env.SECRET_KEY || 'mysecretkey';
const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'DHBW1234')
);
async function runQuery(query, params = {}) {
    const session = driver.session();
    try {
        const result = await session.run(query, params);
        return result.records;
    } catch (error) {
        console.error(chalk.red(`Fehler: ${error.message}`));
    } finally {
        await session.close();
    }
}
async function getLoggedInUser() {
    if (!fs.existsSync('token.txt')) {
        console.log(chalk.red('Du musst dich zuerst anmelden.'));
        return null;
    }
    const token = fs.readFileSync('token.txt', 'utf8');
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        return decoded.email;
    } catch (error) {
        console.log(chalk.red('Token ungültig oder abgelaufen. Bitte erneut anmelden.'));
        return null;
    }
}
async function logoutUser() {
    if (fs.existsSync('token.txt')) {
        fs.unlinkSync('token.txt');
        console.log(chalk.green('Erfolgreich abgemeldet.'));
    } else {
        console.log(chalk.red('Kein aktives Login gefunden.'));
    }
}
const bundesligaTeams = [
    "Bayer 04 Leverkusen", "Bayern München", "Borussia Dortmund", "RB Leipzig", "VfB Stuttgart",
    "Eintracht Frankfurt", "SC Freiburg", "TSG Hoffenheim", "1. FC Heidenheim", "Werder Bremen",
    "VfL Wolfsburg", "FC Augsburg", "Borussia Mönchengladbach", "1. FC Union Berlin", "VfL Bochum",
    "1. FC Köln", "FSV Mainz 05", "SV Darmstadt 98"
];
const userRoles = ['Fan', 'Fußballverein', 'Journalist'];

async function createUser() {
    const answers = await inquirer.prompt([
        { 
            type: 'input', 
            name: 'username', 
            message: 'Benutzername:',
            validate: async (input) => {
                if (!input || input.trim() === '') return 'Benutzername darf nicht leer sein.';
                const existing = await runQuery('MATCH (u:User {username: $username}) RETURN u', { username: input });
                if (existing.length > 0) return 'Benutzername ist bereits vergeben.';
                return true;
            }
        },
        { 
            type: 'input', 
            name: 'email', 
            message: 'E-Mail-Adresse:',
            validate: async (input) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(input)) return 'Bitte gib eine gültige E-Mail-Adresse ein.';
                const existing = await runQuery('MATCH (u:User {email: $email}) RETURN u', { email: input });
                if (existing.length > 0) return 'Diese E-Mail ist bereits registriert.';
                return true;
            }
        },
        { type: 'password', name: 'password', message: 'Passwort:', mask: '*' },
        { type: 'password', name: 'confirmPassword', message: 'Passwort bestätigen:', mask: '*' },
        { type: 'list', name: 'role', message: 'Wähle deine Rolle:', choices: userRoles },
        { 
            type: 'list', 
            name: 'favoriteTeam', 
            message: 'Lieblingsteam:', 
            choices: bundesligaTeams,
            when: (answers) => answers.role === 'Fan' 
        },
        {
            type: 'list',
            name: 'vereinsname',
            message: 'Wähle deinen Verein:',
            choices: bundesligaTeams,
            when: (answers) => answers.role === 'Fußballverein',
            validate: (input) => {
                if (bundesligaTeams.includes(input)) {
                    return true;
                }
                return 'Der Verein muss ein gültiger Bundesliga-Verein sein.';
            }
        },
        {
            type: 'input',
            name: 'medium',
            message: 'Für welches Medium arbeitest du?',
            when: (answers) => answers.role === 'Journalist'
        }
    ]);

    if (answers.password !== answers.confirmPassword) {
        console.log(chalk.red('❗ Passwörter stimmen nicht überein.'));
        return;
    }

    // Wenn Rolle Fußballverein → prüfe, ob Verein schon vergeben
    if (answers.role === 'Fußballverein') {
        const existingClub = await runQuery(
            'MATCH (u:User {role: "Fußballverein", vereinsname: $vereinsname}) RETURN u',
            { vereinsname: answers.vereinsname }
        );
        if (existingClub.length > 0) {
            console.log(chalk.red(`❗ Der Verein "${answers.vereinsname}" ist bereits registriert.`));
            return;
        }
    }

    const hashedPassword = await bcrypt.hash(answers.password, 10);

    const userProperties = {
        username: answers.username,
        email: answers.email,
        password: hashedPassword,
        role: answers.role
    };

    // Rollenspezifische Eigenschaften setzen
    if (answers.role === 'Fan') {
        userProperties.favoriteTeam = answers.favoriteTeam;
    } else if (answers.role === 'Fußballverein') {
        userProperties.vereinsname = answers.vereinsname;
    } else if (answers.role === 'Journalist') {
        userProperties.medium = answers.medium;
    }

    const checkAgain = await runQuery(`
        MATCH (u:User) 
        WHERE u.email = $email OR u.username = $username
        RETURN u
    `, { email: answers.email, username: answers.username });

    if (checkAgain.length > 0) {
        console.log(chalk.red('❗ Benutzer mit dieser E-Mail oder diesem Benutzernamen existiert bereits.'));
        return;
    }
   
    // Benutzer in Neo4j anlegen
    await runQuery(
        'CREATE (u:User $properties)',
        { properties: userProperties }
    );

    console.log(chalk.green(`Benutzer "${answers.username}" (${answers.email}) wurde erfolgreich als ${answers.role} registriert.`));
}

//Anmeldung eines Benutzers
async function loginUser() {
    const answers = await inquirer.prompt([
        { 
            type: 'input', 
            name: 'identifier', 
            message: 'E-Mail-Adresse oder Benutzername:' 
        },
        { 
            type: 'password', 
            name: 'password', 
            message: 'Passwort:', 
            mask: '*' 
        }
    ]);

    const users = await runQuery(`
        MATCH (u:User)
        WHERE u.email = $identifier OR u.username = $identifier
        RETURN u.email as email, u.password as password
    `, { identifier: answers.identifier });

    if (users.length === 0) {
        console.log(chalk.red('Benutzer nicht gefunden.'));
        return;
    }

    const storedPassword = users[0].get('password');
    const userEmail = users[0].get('email');

    const isMatch = await bcrypt.compare(answers.password, storedPassword);
    if (isMatch) {
        const token = jwt.sign({ email: userEmail }, SECRET_KEY, { expiresIn: '1h' });
        fs.writeFileSync('token.txt', token);
        console.log(chalk.green('Erfolgreich angemeldet!'));
        await checkFriendRequests();
    } else {
        console.log(chalk.red('Falsches Passwort.'));
    }
}

async function isAdmin(email) {
    const users = await runQuery('MATCH (u:User {email: $email, role: "admin"}) RETURN u', { email });
    return users.length > 0;
}
async function listUsers() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    if (!(await isAdmin(currentUser))) {
        console.log(chalk.red('Zugriff verweigert – nur Admins.'));
        return;
    }
    const users = await runQuery('MATCH (u:User) RETURN u.email, u.favoriteTeam');
    console.log(chalk.blue('\nBenutzerliste:'));
    users.forEach(user => console.log(`- ${user.get('u.email')} (Team: ${user.get('u.favoriteTeam')})`));
}
async function addFriend() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    // Prüfe ob der aktuelle User ein Fan ist
    const userInfo = await runQuery(
        'MATCH (u:User {email: $email}) RETURN u.role',
        { email: currentUser }
    );
    if (userInfo[0].get('u.role') !== 'Fan') {
        console.log(chalk.red('Nur Fans können Freundschaftsanfragen senden.'));
        return;
    }
    const answers = await inquirer.prompt([
        { type: 'input', name: 'toUser', message: 'E-Mail-Adresse des Fans:' }
    ]);
    // Prüfe ob der Zielbenutzer existiert und ein Fan ist
    const targetUser = await runQuery(
        'MATCH (u:User {email: $email}) RETURN u.role',
        { email: answers.toUser }
    );
    if (targetUser.length === 0) {
        console.log(chalk.red(`Benutzer ${answers.toUser} existiert nicht.`));
        return;
    }
    if (targetUser[0].get('u.role') !== 'Fan') {
        console.log(chalk.red(`${answers.toUser} ist kein Fan.`));
        return;
    }
    // Prüfe ob bereits eine Anfrage besteht
    const requestExists = await runQuery(
        'MATCH (a:User {email: $fromUser})-[r:FRIEND_REQUEST]->(b:User {email: $toUser}) RETURN r',
        { fromUser: currentUser, toUser: answers.toUser }
    );
    if (requestExists.length > 0) {
        console.log(chalk.yellow(`Du hast ${answers.toUser} bereits eine Anfrage gesendet.`));
        return;
    }
    // Verhindere Selbst-Anfrage
    if (currentUser === answers.toUser) {
        console.log(chalk.red('Du kannst dir selbst keine Anfrage senden.'));
        return;
    }
    await runQuery(
        'MATCH (a:User {email: $fromUser}), (b:User {email: $toUser}) CREATE (a)-[:FRIEND_REQUEST]->(b)',
        { fromUser: currentUser, toUser: answers.toUser }
    );
    console.log(chalk.green(`Freundschaftsanfrage an ${answers.toUser} gesendet.`));
}

async function checkFriendRequests() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;

    // Hole Rolle
    const userInfo = await runQuery(
        'MATCH (u:User {email: $email}) RETURN u.role AS role',
        { email: currentUser }
    );
    const role = userInfo[0].get('role');

    // Nur Fans (oder andere definierte Rollen) dürfen Freundschaftsanfragen sehen
    if (role !== 'Fan') {
        return; // oder console.log(chalk.gray('Diese Funktion ist nur für Fans verfügbar.'));
    }

    const requests = await runQuery(`
        MATCH (requester:User)-[r:FRIEND_REQUEST]->(user:User {email: $email})
        RETURN requester.email as fromUser
    `, { email: currentUser });

    if (requests.length === 0) {
        console.log(chalk.blue('Keine ausstehenden Freundschaftsanfragen.'));
        return;
    }

    for (const request of requests) {
        const fromUser = request.get('fromUser');
        const answer = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: `Freundschaftsanfrage von ${fromUser}:`,
            choices: ['Annehmen', 'Ablehnen']
        }]);

        if (answer.action === 'Annehmen') {
            await runQuery(`
                MATCH (a:User {email: $fromUser})-[r:FRIEND_REQUEST]->(b:User {email: $toUser})
                DELETE r
                CREATE (a)-[:FRIENDS_WITH]->(b)
                CREATE (b)-[:FRIENDS_WITH]->(a)
            `, { fromUser: fromUser, toUser: currentUser });
            console.log(chalk.green(`Freundschaft mit ${fromUser} geschlossen!`));
        } else {
            await runQuery(`
                MATCH (a:User {email: $fromUser})-[r:FRIEND_REQUEST]->(b:User {email: $toUser})
                DELETE r
            `, { fromUser: fromUser, toUser: currentUser });
            console.log(chalk.yellow(`Freundschaftsanfrage von ${fromUser} abgelehnt.`));
        }
    }
}

// Erstellen von neuen Beiträgen, Kommentieren von Beiträgen, Bearbeiten und Löschen eigener Beiträge
async function postActions() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;

    const userInfo = await runQuery(
        'MATCH (u:User {email: $email}) RETURN u.role',
        { email: currentUser }
    );

    const userRole = userInfo[0].get('u.role');

    if (!['Fan', 'Fußballverein', 'Journalist'].includes(userRole)) {
        console.log(chalk.red('Diese Aktion ist nur für Fans, Fußballvereine und Journalisten verfügbar.'));
        return;
    }

    const actionChoice = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Was möchtest du tun?',
            choices: [
                { name: 'Neuen Beitrag erstellen', value: 'new_post' },
                { name: 'Beitrag kommentieren', value: 'comment' },
                { name: 'Eigenen Beitrag bearbeiten', value: 'edit_post' },
                { name: 'Eigenen Beitrag löschen', value: 'delete_post' },
                { name: 'Zurück', value: 'back' }
            ]
        }
    ]);

    if (actionChoice.action === 'new_post') {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'content',
                message: 'Dein Beitrag:'
            }
        ]);

        await runQuery(
            'MATCH (u:User {email: $email}) CREATE (u)-[:POSTED]->(p:Post {content: $content, timestamp: timestamp()})',
            { email: currentUser, content: answers.content }
        );
        console.log(chalk.green('Beitrag wurde veröffentlicht.'));
    } else if (actionChoice.action === 'comment') {
        const availablePosts = await runQuery(`
            MATCH (post:Post)<-[:POSTED]-(author:User)
            RETURN 
                ID(post) as postId,
                author.email as author,
                post.content as content,
                post.timestamp as timestamp
            ORDER BY post.timestamp DESC
        `);

        if (availablePosts.length === 0) {
            console.log(chalk.yellow('Keine Beiträge zum Kommentieren verfügbar.'));
            return;
        }

        const { selectedPost } = await inquirer.prompt([
            {
                type: 'list',
                name: 'selectedPost',
                message: 'Wähle einen Beitrag zum Kommentieren:',
                choices: availablePosts.map(post => ({
                    name: `${post.get('author')}: ${post.get('content')} (${formatTimestamp(post.get('timestamp'))})`,
                    value: post.get('postId')
                }))
            }
        ]);

        const { comment } = await inquirer.prompt([
            {
                type: 'input',
                name: 'comment',
                message: 'Dein Kommentar:'
            }
        ]);

        await runQuery(`
            MATCH (u:User {email: $email})
            MATCH (p:Post)
            WHERE ID(p) = $postId
            CREATE (u)-[:COMMENTED {content: $comment, timestamp: timestamp()}]->(p)
        `, {
            email: currentUser,
            postId: selectedPost,
            comment
        });

        console.log(chalk.green('Kommentar wurde hinzugefügt.'));
    } else if (actionChoice.action === 'edit_post') {
        const ownPosts = await runQuery(`
            MATCH (u:User {email: $email})-[:POSTED]->(p:Post)
            RETURN ID(p) as postId, p.content as content, p.timestamp as timestamp
            ORDER BY p.timestamp DESC
        `, { email: currentUser });

        if (ownPosts.length === 0) {
            console.log(chalk.yellow('Du hast keine Beiträge zum Bearbeiten.'));
            return;
        }

        const { postIdToEdit } = await inquirer.prompt([
            {
                type: 'list',
                name: 'postIdToEdit',
                message: 'Welchen Beitrag möchtest du bearbeiten?',
                choices: ownPosts.map(post => ({
                    name: `${post.get('content')} (${formatTimestamp(post.get('timestamp'))})`,
                    value: post.get('postId')
                }))
            }
        ]);

        const { newContent } = await inquirer.prompt([
            {
                type: 'input',
                name: 'newContent',
                message: 'Neuer Inhalt für den Beitrag:'
            }
        ]);

        await runQuery(`
            MATCH (u:User {email: $email})-[:POSTED]->(p:Post)
            WHERE ID(p) = $postId
            SET p.content = $newContent
        `, {
            email: currentUser,
            postId: postIdToEdit,
            newContent
        });

        console.log(chalk.green('Beitrag wurde erfolgreich bearbeitet.'));
    } else if (actionChoice.action === 'delete_post') {
        const ownPosts = await runQuery(`
            MATCH (u:User {email: $email})-[:POSTED]->(p:Post)
            RETURN ID(p) as postId, p.content as content, p.timestamp as timestamp
            ORDER BY p.timestamp DESC
        `, { email: currentUser });

        if (ownPosts.length === 0) {
            console.log(chalk.yellow('Du hast keine Beiträge zum Löschen.'));
            return;
        }

        const { postIdToDelete } = await inquirer.prompt([
            {
                type: 'list',
                name: 'postIdToDelete',
                message: 'Welchen Beitrag möchtest du löschen?',
                choices: ownPosts.map(post => ({
                    name: `${post.get('content')} (${formatTimestamp(post.get('timestamp'))})`,
                    value: post.get('postId')
                }))
            }
        ]);

        await runQuery(`
            MATCH (u:User {email: $email})-[:POSTED]->(p:Post)
            WHERE ID(p) = $postId
            DETACH DELETE p
        `, {
            email: currentUser,
            postId: postIdToDelete
        });

        console.log(chalk.green('Beitrag wurde gelöscht.'));
    }
}

// Hilfsfunktion zum Formatieren des Timestamps
function formatTimestamp(timestamp) {
    return new Date(parseInt(timestamp)).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

async function listPosts() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    const userInfo = await runQuery(
        'MATCH (u:User {email: $email}) RETURN u.role, u.favoriteTeam, u.vereinsname',
        { email: currentUser }
    );
    
    const userRole = userInfo[0].get('u.role');
    const favoriteTeam = userInfo[0].get('u.favoriteTeam');
    const vereinsname = userInfo[0].get('u.vereinsname');
    // Spezielle Ansicht für Vereine
    if (userRole === 'Fußballverein') {
        const posts = await runQuery(`
            MATCH (u:User)-[:POSTED]->(p:Post)
            WHERE u.email = $email OR 
                  u.favoriteTeam = $vereinsname OR 
                  p.vereinsname = $vereinsname
            OPTIONAL MATCH (p)<-[like:LIKED]-(liker:User)
            OPTIONAL MATCH (p)<-[comment:COMMENTED]-(commenter:User)
            RETURN 
                ID(p) as postId,
                u.email as author,
                p.content as content,
                p.timestamp as timestamp,
                CASE 
                    WHEN u.email = $email THEN 'own'
                    WHEN u.role = 'Fan' THEN 'fan'
                    ELSE 'other'
                END as type,
                collect(DISTINCT liker.email) as likedBy,
                size(collect(DISTINCT liker.email)) as likeCount,
                collect(DISTINCT {
                    commenter: commenter.email,
                    content: comment.content
                }) as comments
            ORDER BY p.timestamp DESC
        `, { 
            email: currentUser,
            vereinsname: vereinsname
        });

        // Anzeige der Posts mit Kommentaren
        console.log(chalk.blue('\nVereinsbezogene Beiträge:'));
        
        // Eigene Vereins-Updates
        console.log(chalk.yellow('\n⚽ Deine Vereins-Updates:'));
        const ownPosts = posts.filter(post => post.get('type') === 'own');
        if (ownPosts.length > 0) {
            ownPosts.forEach(post => {
                console.log(`- ${post.get('content')} [${post.get('likeCount')} Likes] (${formatTimestamp(post.get('timestamp'))})`);
                const comments = post.get('comments').filter(c => c.commenter);
                if (comments.length > 0) {
                    console.log(chalk.gray('  Kommentare:'));
                    comments.forEach(comment => {
                        console.log(chalk.gray(`  - ${comment.commenter}: ${comment.content}`));
                    });
                }
            });
        } else {
            console.log('Keine eigenen Updates vorhanden.');
        }

        // Fan-Beiträge über den Verein
        console.log(chalk.yellow('\n👥 Fan-Beiträge über deinen Verein:'));
        const fanPosts = posts.filter(post => post.get('type') === 'fan');
        if (fanPosts.length > 0) {
            fanPosts.forEach(post => {
                console.log(`- ${post.get('author')}: ${post.get('content')} [${post.get('likeCount')} Likes] (${formatTimestamp(post.get('timestamp'))})`);
                const comments = post.get('comments').filter(c => c.commenter);
                if (comments.length > 0) {
                    console.log(chalk.gray('  Kommentare:'));
                    comments.forEach(comment => {
                        console.log(chalk.gray(`  - ${comment.commenter}: ${comment.content}`));
                    });
                }
            });
        } else {
            console.log('Keine Fan-Beiträge vorhanden.');
        }

        // Option zum Kommentieren anbieten
        const actionChoice = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Was möchtest du tun?',
                choices: [
                    { name: 'Auf Fan-Beitrag antworten', value: 'comment_fan' },
                    { name: 'Zurück', value: 'back' }
                ]
            }
        ]);

        if (actionChoice.action === 'comment_fan') {
            const fanPosts = posts.filter(post => post.get('type') === 'fan');
            if (fanPosts.length === 0) {
                console.log(chalk.yellow('Keine Fan-Beiträge zum Kommentieren verfügbar.'));
                return;
            }

            const postChoice = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedPost',
                    message: 'Wähle einen Beitrag zum Kommentieren:',
                    choices: fanPosts.map(post => ({
                        name: `${post.get('author')}: ${post.get('content')} (${formatTimestamp(post.get('timestamp'))})`,
                        value: post.get('postId')
                    }))
                },
                {
                    type: 'input',
                    name: 'comment',
                    message: 'Dein Kommentar:'
                }
            ]);

            // Kommentar hinzufügen
            await runQuery(`
                MATCH (u:User {email: $email})
                MATCH (p:Post)
                WHERE ID(p) = $postId
                CREATE (u)-[:COMMENTED {content: $comment, timestamp: timestamp()}]->(p)
            `, {
                email: currentUser,
                postId: postChoice.selectedPost,
                comment: postChoice.comment
            });

            console.log(chalk.green('Kommentar wurde hinzugefügt.'));
        }
    } else if (userRole === 'Fan') {
        const teamCounts = await runQuery(`
            MATCH (me:User {email: $email})-[:FRIENDS_WITH]->(friend:User)
            WHERE friend.favoriteTeam IS NOT NULL
            RETURN friend.favoriteTeam as team, count(*) as count
        `, { email: currentUser });
    
        const extraTeams = teamCounts
            .filter(row => row.get('count') >= 5 && row.get('team') !== favoriteTeam)
            .map(row => row.get('team'));
    
        const posts = await runQuery(`
            MATCH (currentUser:User {email: $email})
    
            // Lieblingsverein
            OPTIONAL MATCH (team:User {role: 'Fußballverein', vereinsname: $favoriteTeam})-[:POSTED]->(teamPost:Post)
            OPTIONAL MATCH (teamPost)<-[teamLike:LIKED]-(teamLiker:User)
            OPTIONAL MATCH (teamPost)<-[teamComment:COMMENTED]-(teamCommenter:User)
            WITH currentUser, team, teamPost,
                 COLLECT(DISTINCT teamLiker.email) AS likedByTeam,
                 COUNT(DISTINCT teamLike) AS likeCountTeam,
                 COLLECT(DISTINCT {commenter: teamCommenter.email, content: teamComment.content}) AS commentsTeam
            WITH currentUser, COLLECT({
                author: team.email,
                content: teamPost.content,
                timestamp: teamPost.timestamp,
                type: 'team',
                likeCount: likeCountTeam,
                likedBy: likedByTeam,
                comments: commentsTeam
            }) AS teamPosts
    
            // Fan-Austausch
            OPTIONAL MATCH (fan:User {role: 'Fan', favoriteTeam: $favoriteTeam})-[:POSTED]->(fanPost:Post)
            WHERE fan.email <> currentUser.email
            OPTIONAL MATCH (fanPost)<-[fanLike:LIKED]-(fanLiker:User)
            OPTIONAL MATCH (fanPost)<-[fanComment:COMMENTED]-(fanCommenter:User)
            WITH currentUser, teamPosts, fan, fanPost,
                 COLLECT(DISTINCT fanLiker.email) AS likedByFan,
                 COUNT(DISTINCT fanLike) AS likeCountFan,
                 COLLECT(DISTINCT {commenter: fanCommenter.email, content: fanComment.content}) AS commentsFan
            WITH currentUser, teamPosts,
                 COLLECT({
                    author: fan.email,
                    content: fanPost.content,
                    timestamp: fanPost.timestamp,
                    type: 'fanExchange',
                    likeCount: likeCountFan,
                    likedBy: likedByFan,
                    comments: commentsFan
                 }) AS fanPosts
            WITH currentUser, teamPosts + fanPosts AS posts1
    
            // Freunde
            OPTIONAL MATCH (currentUser)-[:FRIENDS_WITH]->(friend:User)-[:POSTED]->(friendPost:Post)
            OPTIONAL MATCH (friendPost)<-[friendLike:LIKED]-(friendLiker:User)
            OPTIONAL MATCH (friendPost)<-[friendComment:COMMENTED]-(friendCommenter:User)
            WITH currentUser, posts1, friend, friendPost,
                 COLLECT(DISTINCT friendLiker.email) AS likedByFriend,
                 COUNT(DISTINCT friendLike) AS likeCountFriend,
                 COLLECT(DISTINCT {commenter: friendCommenter.email, content: friendComment.content}) AS commentsFriend
            WITH currentUser, posts1,
                 COLLECT({
                    author: friend.email,
                    content: friendPost.content,
                    timestamp: friendPost.timestamp,
                    type: 'friend',
                    likeCount: likeCountFriend,
                    likedBy: likedByFriend,
                    comments: commentsFriend
                 }) AS friendPosts
            WITH currentUser, posts1 + friendPosts AS posts2
    
            // Extra-Vereine
            OPTIONAL MATCH (extraTeam:User)
            WHERE extraTeam.role = 'Fußballverein' AND extraTeam.vereinsname IN $extraTeams
            OPTIONAL MATCH (extraTeam)-[:POSTED]->(extraPost:Post)
            OPTIONAL MATCH (extraPost)<-[extraLike:LIKED]-(extraLiker:User)
            OPTIONAL MATCH (extraPost)<-[extraComment:COMMENTED]-(extraCommenter:User)
            WITH posts2, extraTeam, extraPost,
                 COLLECT(DISTINCT extraLiker.email) AS likedByExtra,
                 COUNT(DISTINCT extraLike) AS likeCountExtra,
                 COLLECT(DISTINCT {commenter: extraCommenter.email, content: extraComment.content}) AS commentsExtra
            WITH posts2,
                 COLLECT({
                    author: extraTeam.email,
                    content: extraPost.content,
                    timestamp: extraPost.timestamp,
                    type: 'extraTeam',
                    likeCount: likeCountExtra,
                    likedBy: likedByExtra,
                    comments: commentsExtra
                 }) AS extraTeamPosts
            WITH posts2 + extraTeamPosts AS allPosts
    
            UNWIND allPosts AS post
            WITH post
            WHERE post.content IS NOT NULL
            RETURN 
                post.author AS author,
                post.content AS content,
                post.timestamp AS timestamp,
                post.type AS type,
                post.likedBy AS likedBy,
                post.likeCount AS likeCount,
                post.comments AS comments
            ORDER BY post.timestamp DESC
        `, {
            email: currentUser,
            favoriteTeam,
            extraTeams
        });
    
        if (!posts || posts.length === 0) {
            console.log(chalk.yellow('Keine Beiträge gefunden.'));
            return;
        }
    
        console.log(chalk.blue('\nBeiträge für dich:'));
    
        const typeLabels = {
            team: '⚽ Updates deines Lieblingsvereins:',
            fanExchange: '👥 Fan-Austausch (gleicher Verein):',
            friend: '🤝 Beiträge deiner Freunde:',
            extraTeam: '🏟 Beiträge anderer interessanter Vereine:'
        };
    
        for (const [type, label] of Object.entries(typeLabels)) {
            const filtered = posts.filter(p => p.get('type') === type);
            if (filtered.length > 0) {
                console.log(chalk.yellow(`\n${label}`));
                filtered.forEach(post => {
                    const author = post.get('author') === currentUser ? 'Ich' : post.get('author');
                    const likeInfo = `[${post.get('likeCount')} Likes]`;
                    console.log(`- ${author}: ${post.get('content')} ${likeInfo} (${formatTimestamp(post.get('timestamp'))})`);
    
                    const comments = post.get('comments').filter(c => c.commenter);
                    if (comments.length > 0) {
                        console.log(chalk.gray('  Kommentare:'));
                        comments.forEach(comment => {
                            const commenterName = comment.commenter === currentUser ? 'Ich' : comment.commenter;
                            console.log(chalk.gray(`  - ${commenterName}: ${comment.content}`));
                        });
                    }
                });  
            }
        }    
    } else {
        if (userRole.toLowerCase() === 'journalist') {
            try {
                const action = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'view',
                        message: 'Was möchtest du sehen?',
                        choices: [
                            { name: '🔎 Beiträge nach Verein filtern', value: 'filter_by_team' },
                            { name: '🏆 Top 5 Beiträge mit den meisten Likes', value: 'top_liked' },
                            { name: '💬 Beiträge mit den meisten Kommentaren', value: 'top_commented' },
                            { name: '🕒 Beiträge der letzten 24 Stunden', value: 'last_24h' },
                            { name: '📋 Alle Beiträge anzeigen', value: 'all' },
                            { name: '🔙 Zurück', value: 'back' }
                        ]
                    }
                ]);
    
                if (action.view === 'back') return;
    
                let query = `
                    MATCH (p:Post)<-[:POSTED]-(u:User)
                    OPTIONAL MATCH (p)<-[like:LIKED]-(liker:User)
                    OPTIONAL MATCH (p)<-[comment:COMMENTED]-(commenter:User)
                `;
    
                const params = {};
    
                if (action.view === 'filter_by_team') {
                    const input = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'team',
                            message: 'Gib den Vereinsnamen ein:'
                        }
                    ]);
    
                    if (!input.team || input.team.trim() === '') {
                        console.log(chalk.red('❗ Kein Vereinsname eingegeben. Abbruch.'));
                        return;
                    }
    
                    query += `WHERE p.vereinsname = $team `;
                    params.team = input.team.trim();
                } else if (action.view === 'last_24h') {
                    query += `WHERE p.timestamp > timestamp() - 86400000 `;
                }
    
                query += `
                    RETURN 
                        u.email as author,
                        p.content as content,
                        p.timestamp as timestamp,
                        p.vereinsname as team,
                        collect(DISTINCT liker.email) as likedBy,
                        size(collect(DISTINCT liker.email)) as likeCount,
                        collect(DISTINCT {commenter: commenter.email, content: comment.content}) as comments
                `;
    
                if (action.view === 'top_liked') {
                    query += ' ORDER BY likeCount DESC LIMIT 5';
                } else if (action.view === 'top_commented') {
                    query += ' ORDER BY size(collect(DISTINCT comment)) DESC LIMIT 5';
                } else {
                    query += ' ORDER BY p.timestamp DESC';
                }
    
                const posts = await runQuery(query, params);
    
                if (!posts || posts.length === 0) {
                    console.log(chalk.yellow('Keine Beiträge gefunden.'));
                    return;
                }
    
                console.log(chalk.green('\n🔍 Gefundene Beiträge:'));
                posts.forEach(post => {
                    const likeInfo = `[${post.get('likeCount')} Likes]`;
                    const team = post.get('team') ? ` (${post.get('team')})` : '';
                    console.log(`- ${post.get('author')}: ${post.get('content')} ${likeInfo}${team} (${formatTimestamp(post.get('timestamp'))})`);
    
                    const comments = post.get('comments').filter(c => c.commenter);
                    if (comments.length > 0) {
                        console.log(chalk.gray('  Kommentare:'));
                        comments.forEach(comment => {
                            console.log(chalk.gray(`  - ${comment.commenter}: ${comment.content}`));
                        });
                    }
                });
            } catch (err) {
                console.error(chalk.red('❗ Fehler in der Journalistenansicht:'), err);
            }
        } else {
            console.log(chalk.red(`❗ Keine Ansicht für die Rolle '${userRole}' implementiert.`));
        }
    }                     
}


async function listClubs() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;

    const clubs = await runQuery(`
        MATCH (u:User {role: 'Fußballverein'})
        RETURN u.vereinsname AS name
        ORDER BY name
    `);

    console.log(chalk.blue('\n⚽ Fußballvereine:'));
    if (clubs.length === 0) {
        console.log(chalk.yellow('Keine Fußballvereine gefunden.'));
        return;
    }

    clubs.forEach(club => console.log(`- ${club.get('name')}`));
}

async function deletePost() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    // Zeige erst die eigenen Beiträge an
    const userPosts = await runQuery(
        'MATCH (u:User {email: $email})-[:POSTED]->(p:Post) RETURN p.content, p.timestamp ORDER BY p.timestamp DESC',
        { email: currentUser }
    );
    if (userPosts.length === 0) {
        console.log(chalk.yellow('Du hast noch keine Beiträge erstellt.'));
        return;
    }
    // Liste alle Beiträge des Users auf
    console.log(chalk.blue('\nDeine Beiträge:'));
    const postChoices = userPosts.map(post => ({
        name: `${post.get('p.content')} (${new Date(post.get('p.timestamp').low).toLocaleString()})`,
        value: post.get('p.content')
    }));
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'content',
            message: 'Wähle den Beitrag zum Löschen:',
            choices: postChoices
        }
    ]);
    // Lösche nur den Beitrag, wenn er dem aktuellen User gehört
    const result = await runQuery(
        'MATCH (u:User {email: $email})-[:POSTED]->(p:Post {content: $content}) DETACH DELETE p',
        { email: currentUser, content: answers.content }
    );
    console.log(chalk.green('Beitrag wurde gelöscht.'));
}
async function likePost() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    // Hole alle verfügbaren Posts mit Like-Informationen
    const availablePosts = await runQuery(`
        MATCH (post:Post)<-[:POSTED]-(author:User)
        OPTIONAL MATCH (post)<-[like:LIKED]-(liker:User)
        RETURN 
            ID(post) as postId,
            author.email as author,
            post.content as content,
            post.timestamp as timestamp,
            collect(DISTINCT liker.email) as likedBy,
            size(collect(DISTINCT liker.email)) as likeCount
        ORDER BY post.timestamp DESC
    `);
    if (availablePosts.length === 0) {
        console.log(chalk.yellow('Keine Beiträge zum Liken verfügbar.'));
        return;
    }
    // Erstelle Auswahlmöglichkeiten für Posts
    const postChoices = availablePosts.map(post => ({
        name: `${post.get('author')}: ${post.get('content')} [${post.get('likeCount')} Likes] (${formatTimestamp(post.get('timestamp'))})`,
        value: {
            postId: post.get('postId'),
            content: post.get('content'),
            likedBy: post.get('likedBy')
        }
    }));
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedPost',
            message: 'Welchen Beitrag möchtest du liken?',
            choices: postChoices
        }
    ]);
    // Prüfe, ob der Benutzer den Post bereits geliked hat
    if (answers.selectedPost.likedBy.includes(currentUser)) {
        console.log(chalk.yellow('Du hast diesen Beitrag bereits geliked.'));
        return;
    }
    // Like den Post
    await runQuery(`
        MATCH (u:User {email: $email})
        MATCH (p:Post)
        WHERE ID(p) = $postId
        CREATE (u)-[:LIKED]->(p)
    `, {
        email: currentUser,
        postId: answers.selectedPost.postId
    });
    console.log(chalk.green('Beitrag wurde geliked!'));
}
async function viewAllData() {
    const currentUser = await getLoggedInUser();
    if (!currentUser) return;
    const admin = await isAdmin(currentUser);
    if (!admin) {
        console.log(chalk.red('Zugriff verweigert – nur Admins.'));
        return;
    }
    console.log(chalk.blue('Starte vollständige Datenübersicht (für Neo4j Browser):'));
    console.log(chalk.yellow('Führe bitte folgenden Befehl im Neo4j Browser aus:'));
    console.log(`\nMATCH (n)-[r]->(m)\nRETURN n, r, m`);
}

async function createAdmin() {
    // Prüfe ob bereits ein Admin existiert
    const existingAdmin = await runQuery(
        'MATCH (u:User {role: "admin"}) RETURN u'
    );

    if (existingAdmin.length > 0) {
        console.log(chalk.red('Es existiert bereits ein Admin-Account.'));
        return;
    }

    // Erstelle neuen Admin
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await runQuery(
        `
        CREATE (u:User {
            email: 'admin@admin.de',
            password: $password,
            role: 'admin'
        })
        `,
        { password: hashedPassword }
    );    

    console.log(chalk.green('Admin-Account wurde erstellt:'));
    console.log(chalk.blue('Email: admin@admin.de'));
    console.log(chalk.blue('Passwort: admin123'));
}
program.version('1.0.0').description('CLI-Tool für Neo4j und Fußball-Community');
program.command('logout').description('Abmelden').action(logoutUser);
program.command('create-user').description('Benutzer erstellen').action(createUser);
program.command('login-user').description('Anmelden').action(loginUser);
program.command('list-users').description('Benutzer auflisten').action(listUsers);
program.command('post-actions').description('Beitrag erstellen').action(postActions);
program.command('list-posts').description('Beiträge anzeigen').action(listPosts);
program.command('list-clubs').description('Vereine anzeigen').action(listClubs);
program.command('delete-post').description('Beitrag löschen').action(deletePost);
program.command('like-post').description('Beitrag liken').action(likePost);
program.command('admin-view').description('Alle Daten anzeigen (Admin)').action(viewAllData);
program.command('add-friend').description('Freund hinzufügen').action(addFriend);
program.command('check-requests').description('Freundschaftsanfragen prüfen').action(checkFriendRequests);
program.command('create-admin').description('Admin-Account erstellen').action(createAdmin);
program.parse(process.argv);