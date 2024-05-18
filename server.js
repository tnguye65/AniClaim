const http = require('http');
const express = require('express');
const ejs = require('ejs');
const app = express();
const bodyParser = require('body-parser');
const path = require("path");
const session = require('express-session');
const portNumber = 5003;

require("dotenv").config({ path: path.resolve(__dirname, 'credentials/.env') })  
const uri = process.env.MONGO_CONNECTION_STRING;

// Database of users
const databaseAndCollection = {db: "aniClaim", collection:"userData"};

// Database prepopulated with the top 1000 characters according to MAL
const databaseAndCollection1000 = {db: "aniClaim", collection:"top1000Characters"};

const { MongoClient, ServerApiVersion } = require('mongodb');
let client;
let top1000;

async function main() {
    client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
    try {
        await client.connect();
        const name = "top";
        top1000 = await client.db(databaseAndCollection1000.db).collection(databaseAndCollection1000.collection).findOne({name});
    } catch(e) {
        console.error(`Error connecting to MongoDB: ${e.message}`);
    } finally {
        await client.close();
    }
}

app.use(bodyParser.urlencoded({extended:false}));
app.set("views", path.resolve(__dirname, "templates"));
app.set("view engine", "ejs");
app.use(express.static(__dirname + '/public'));
app.use(session({
    secret: 'cmsc335',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.get("/", async (request, response) => {
    if (request.session.user) {
        return response.render("loggedin", { name: request.session.user.username});
    }
	response.render("index");
});

app.post('/', async (request, response) => {
    try {
        request.session.destroy(err => {
            if (err) {
                console.error('Logout error:', err);
                return response.status(500).send('Internal server error');
            }
            response.redirect('/');
        });
    } catch (error) {
        console.error('Logout error:', error);
        response.status(500).send('Internal server error');
    }
});

app.get("/login", (request, response) => {
	response.render("login", {errorMessage: null});
});

app.post('/login', async (req,res) =>{
    try {
        await client.connect();
        const user = {
            email: req.body.email,
            username: req.body.username,
            password: req.body.password,
            characters: {},
            wallet: 0
        };
        await addUser(user);
        res.render("login", {errorMessage: null});
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
});

app.get("/register", (request, response) => {
	response.render("register");
});

app.post('/loggedin', async (request,response) =>{
    try {
        await client.connect();
        const {username, password} = request.body;
        const user = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).findOne({username});
        if (!user || password != user.password) {
            // Render login page with error message
            return response.render('login', { errorMessage: 'Incorrect username or password' });
        }
        request.session.user = user;
        response.render("loggedin", { name: request.session.user.username});
    } catch (e) {
        console.error(e);
        // Render login page with error message
        response.render('login', { errorMessage: 'An error ocrequest.session.usered. Please try again later.' });
    } finally {
        await client.close();
    }
});

app.get('/account', async (request,response) =>{
    const keys = Object.keys(request.session.user.characters);
    keys.sort((id1, id2) => {
        return request.session.user.characters[id2].price - request.session.user.characters[id1].price;
    });
    let characters = '';
    keys.forEach(id => {
        characters += `<a href="/character/:${id}" style="color: black; text-decoration: none;">`;
        characters += `<div class="card"><strong> ${request.session.user.characters[id].name} </strong><br>`;
        characters += `<img src="${request.session.user.characters[id].img}" alt="N/A">`;
        characters += `<br><strong>${request.session.user.characters[id].rank} (x${request.session.user.characters[id].count})</strong></div></a>`;
    });
    response.render('account', { user: request.session.user, characters: characters });
});

app.post('/sell', async (request,response) =>{
    if (!request.session.user) {
        return response.status(404).send('User not found');
    }
    try {
        const id = request.body.id;

        if (!request.session.user.characters.hasOwnProperty(id)) {
            console.log(id);
            return response.status(404).send('Character not owned');
        }

        request.session.user.wallet += request.session.user.characters[id].price;

        if (request.session.user.characters[id].count > 1) {
            console.log(`Sold 1 of ${request.session.user.characters[id].name} from collection`);
            request.session.user.characters[id].count -= 1;
        } else {
            console.log(`${request.session.user.characters[id].name} deleted from collection`);
            delete request.session.user.characters[id];
        }

        const query = {username: request.session.user.username};
        const update = {characters: request.session.user.characters, wallet: request.session.user.wallet};
        await updateUser(query, update);

        const keys = Object.keys(request.session.user.characters);
        keys.sort((id1, id2) => {
            return request.session.user.characters[id2].price - request.session.user.characters[id1].price;
        });

        let characters = '';
        keys.forEach(id => {
            characters += `<a href="/character/:${id}" style="color: black; text-decoration: none;">`;
            characters += `<div class="card"><strong> ${request.session.user.characters[id].name} </strong><br>`;
            characters += `<img src="${request.session.user.characters[id].img}" alt="N/A">`;
            characters += `<br><strong>${request.session.user.characters[id].rank} (x${request.session.user.characters[id].count})</strong></div></a>`;
        });
        response.render('account', { user: request.session.user, characters: characters });

    } catch (e) {
        console.error('There was a problem with the fetch operation:', e);
        return response.status(404).send('There was a problem with the fetch operation:');
    }
});

app.get("/character/:id", async (request, response) => {
    const id = request.params.id.substring(1);

    try {
        const characterData = await fetchCharacterData(id);

        if (!characterData) {
            return response.status(404).send('Character not found');
        }

        let owned = false;
        let price = 0;

        if (request.session.user.characters.hasOwnProperty(id)) {
            owned = true;
            price = request.session.user.characters[id].price;
        }

        response.render('character', { character: characterData, owned: owned, price: price, id: id });
    } catch (error) {
        console.error('Error fetching character data:', error);
        response.status(500).send('Internal server error');
    }
});

app.get("/roll", (request, response) => {
    if (!request.session.user) {
        return response.status(404).send('User not found');
    }
    response.render("roll");
});

app.post("/roll", async (request, response) => {
    if (!request.session.user) {
        return response.status(404).send('User not found');
    }
    try {
        await client.connect();
        const idIndex =  Math.floor(Math.random() * 1000);
        const keys = Object.keys(top1000.characters);
        let id = keys[idIndex];

        if (request.session.user.characters[id]) {
            request.session.user.characters[id].count += 1;
        } else {
            data = await fetchCharacterData(id);
            if (!data) {
                response.render('404');
                return;
            }
            request.session.user.characters[id] = data;
        }
        const query = {username: request.session.user.username};
        const update = {characters: request.session.user.characters};
        await updateUser(query, update);

        if (request.session.user.characters[id].rank)

        response.render('results', { character: request.session.user.characters[id] });
    } catch (e) {
        console.error('There was a problem with the fetch operation:', e);
        response.render('404');
    }
});

app.get("/allcharacters", async (req, res) => {
    try {
        const keys = Object.keys(top1000.characters);
        keys.sort((id1, id2) => {
            return getPrice(top1000.characters[id2].rank) - getPrice(top1000.characters[id1].rank);
        });
        let characters = '';
        keys.forEach(id => {
            characters += `<a href="/character/:${id}" style="color: black; text-decoration: none;">`;
            characters += `<div class="card"><strong> ${top1000.characters[id].name} </strong><br>`;
            characters += `<img src="${top1000.characters[id].img}" alt="N/A">`;
            characters += `<br><strong>${top1000.characters[id].rank}</strong></div></a>`;
        });

        res.render("allcharacters", { characters: characters });
    } catch (e) {
        console.error('There was a problem with the fetch operation:', e);
        res.render('404');
    }
});

app.get("/leaderboard", async (req, res) => {
    try {
        await client.connect();
        const lst = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).find().sort({wallet: -1}).toArray();
        let table = "<table style='border: 1px solid black'><tr><th>Rank</th><th>Name</th><th>Balance</th></tr>";
        for (let i = 0; i < lst.length; i++) {
            table += `<tr><td>${i+1}</td><td>${lst[i].username}</td><td>$${lst[i].wallet}</td></tr>`;
        }
        table += "</table style='border: 1'>";
        res.render('leaderboard', {table});
    } catch (e) {
        console.error('There was a problem with the loading leaderboards:', e);
        res.render('404');
    } finally {
        await client.close();
    }
});

app.get("/about", (req, res) => {
    res.render("about");
})

async function addUser(user) {
    const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection).insertOne(user);
}

async function updateUser(query, update) {
    try {
        await client.connect();
        const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.collection)
                    .updateOne(query, { $set: update });
        console.log(`${result.modifiedCount} document(s) updated`);
    } finally {
        await client.close();
    }
}

async function fetchCharacterData(id) {
    if (request.session.user.characters.hasOwnProperty(id)) {
        return request.session.user.characters[id];
    }

    try {
        let apiUrl = `https://api.jikan.moe/v4/characters/${id}/full`;
        let character = await fetch(apiUrl);
        if (!character.ok) {
            console.error('Error fetching character data');
            return null;
        }
        
        let characterData = await character.json();
    
        const summary = characterData.data.about ? characterData.data.about.replace(/\n/g, "<br>") : "N/A";
        const imgURL = characterData.data.images.jpg.image_url || "/assets/question.png";
        const rank = getRank(characterData.data.favorites);
        const price = getPrice(rank);

        const data = {
            name: characterData.data.name,
            anime: characterData.data.anime[0].anime.title,
            summary: summary,
            rank: rank,
            price: price,
            img: imgURL,
            count: 1
        };

        return data;

    } catch (e) {
        console.error('There was a problem with the fetch operation:', e);
    }
}

function getRank(favs) {
    if (favs >= 84000) {
        return "S";
    }
    if (favs >= 37000) {
        return "A";
    }
    if (favs >= 22000) {
        return "B";
    }
    if (favs >= 9500) {
        return "C";
    }
    return "D";
}

function getPrice(rank) {
    if (rank == "S") {
        return 10000;
    }
    if (rank == "A") {
        return 5000;
    }
    if (rank == "B") {
        return 3000;
    }
    if (rank == "C") {
        return 500;
    }
    return 100;
}

function getRate(rank) {
    if (rank == "S") {
        return 1;
    }
    if (rank == "A") {
        return 2.3;
    }
    if (rank == "B") {
        return 4.8;
    }
    if (rank == "C") {
        return 16.4;
    }
    return 75.5;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function populateIDs() {
    try {
        await client.connect();
        let topCharactersData = {};
        let page = 1;
        while (page <= 40) {
            await delay(1000);
            let query = {page: page, order_by: "favorites", sort: "desc"};
            let queryString = new URLSearchParams(query).toString();
            let apiUrl = `https://api.jikan.moe/v4/characters?${queryString}`;

            let characters25 = await fetch(apiUrl);

            if (!characters25.ok) {
                console.log("hello");
                console.error('Error fetching character data');
                return null;
            }

            const characters = await characters25.json();

            let charactersData = characters.data;

            charactersData.forEach(character => {
                let imgURL = character.images.jpg.image_url || "/assets/question.png";
                let rank = getRank(character.favorites);
                topCharactersData[character.mal_id] = {
                    name: character.name,
                    img: imgURL,
                    rank: rank
                }
            });

            page += 1;
        }
        const top1000 = {
            name: "top",
            characters: topCharactersData
        };
        await client.db(databaseAndCollection1000.db).collection(databaseAndCollection1000.collection).insertOne(top1000);

    } catch (e) {
        console.error('There was a problem with the fetch operation:', e);
    }
}
  
main();
const server = http.createServer(app);
server.listen(portNumber);
console.log(`Web server started and running at http://localhost:${portNumber}`);
process.stdout.write('Stop to shutdown the server: ')
process.stdin.setEncoding("utf8");
process.stdin.on('readable', () => {
    const dataInput = process.stdin.read();
    if (dataInput) {
        const command = dataInput.trim();
        if (command === "stop") {
            console.log("Shutting down the server");
            server.close(() => {
                process.exit(0);
            });
        } else {
            console.log(`Invalid command: ${command}`);
            process.stdout.write('Stop to shutdown the server: ');
			process.stdin.resume();
        }
    }
});
