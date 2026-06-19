const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const port = process.env.PORT || 8000;
dotenv.config();
app.use(express.json());
app.use(cors());

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

const db = client.db("GestorFitness");
const forumPostsCollection = db.collection("forumPosts");

// Add a new forum post
app.post('/forum-posts', async (req, res) => {
  try {
    const post = req.body;
    post.createdAt = new Date();
    post.upvotes = 0;
    post.downvotes = 0;
    const result = await forumPostsCollection.insertOne(post);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).send({ message: "Failed to create post", error });
  }
});

// Get all forum posts with pagination
app.get('/forum-posts', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const authorId = req.query.authorId;
    const skip = (page - 1) * limit;

    const matchQuery = {};
    if (authorId) {
      matchQuery.authorId = authorId;
    }

    const posts = await forumPostsCollection
      .find(matchQuery)
      .sort({ createdAt: -1 }) // Newest posts first
      .skip(skip)
      .limit(limit)
      .toArray();

    // Simple loop to get the latest user information using the user ID
    const usersCollection = db.collection("user");
    
    for (let post of posts) {
      if (post.authorId && post.authorId.length === 24) {
        const user = await usersCollection.findOne({ _id: new ObjectId(post.authorId) });
        if (user) {
          post.author = user.name || post.author;
          post.authorEmail = user.email || post.authorEmail;
          post.authorImage = user.image || post.authorImage;
          post.role = user.role || post.role;
        }
      }
    }
      
    const total = await forumPostsCollection.countDocuments(matchQuery);
    
    res.send({ 
      posts, 
      total, 
      currentPage: page, 
      totalPages: Math.ceil(total / limit) 
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    res.status(500).send({ message: "Failed to fetch posts", error });
  }
});

// Middleware to check if the user is the owner of the post or an admin
const checkPostOwnership = async (req, res, next) => {
  try {
    const id = req.params.id;
    const authorId = req.body.authorId || req.query.authorId;
    const role = req.body.role || req.query.role;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid post ID format" });
    }

    const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
    if (!post) {
      return res.status(404).send({ message: "Post not found" });
    }

    if (post.authorId !== authorId && role !== "admin") {
      return res.status(403).send({ message: "Forbidden: You don't have permission to perform this action" });
    }

    req.post = post;
    next();
  } catch (error) {
    console.error("Error in authorization middleware:", error);
    res.status(500).send({ message: "Server error during authorization", error });
  }
};

// Update a forum post
app.patch('/forum-posts/:id', checkPostOwnership, async (req, res) => {
  try {
    const id = req.params.id;
    const { authorId, role, ...updates } = req.body;
    
    // Prevent changing protected fields
    delete updates._id;
    delete updates.createdAt;
    
    updates.updatedAt = new Date();

    const result = await forumPostsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );
    res.send(result);
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).send({ message: "Failed to update post", error });
  }
});

// Delete a forum post
app.delete('/forum-posts/:id', checkPostOwnership, async (req, res) => {
  try {
    const result = await forumPostsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).send({ message: "Failed to delete post", error });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!')
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

