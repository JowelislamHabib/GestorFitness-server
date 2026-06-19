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
const forumCommentsCollection = db.collection("forumComments");

// Add a new forum post
app.post('/forum-posts', async (req, res) => {
  try {
    const post = req.body;
    post.createdAt = new Date();
    post.upvotes = 0;
    post.downvotes = 0;
    post.upvotedBy = [];
    post.downvotedBy = [];
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

// Get a single forum post
app.get('/forum-posts/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid ID format" });
    }
    const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
    if (!post) {
      return res.status(404).send({ message: "Post not found" });
    }
    res.send(post);
  } catch (error) {
    console.error("Error fetching single post:", error);
    res.status(500).send({ message: "Failed to fetch post", error });
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

// Vote on a forum post
app.post('/forum-posts/:id/vote', async (req, res) => {
  try {
    const id = req.params.id;
    const { userId, action } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid post ID format" });
    }
    if (!userId || !action) {
      return res.status(400).send({ message: "Missing userId or action" });
    }

    const post = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
    if (!post) {
      return res.status(404).send({ message: "Post not found" });
    }

    const upvotedBy = post.upvotedBy || [];
    const downvotedBy = post.downvotedBy || [];

    let updateQuery = {};

    if (action === "upvote") {
      if (upvotedBy.includes(userId)) {
        updateQuery = { $pull: { upvotedBy: userId } };
      } else {
        updateQuery = { 
          $addToSet: { upvotedBy: userId },
          $pull: { downvotedBy: userId }
        };
      }
    } else if (action === "downvote") {
      if (downvotedBy.includes(userId)) {
        updateQuery = { $pull: { downvotedBy: userId } };
      } else {
        updateQuery = { 
          $addToSet: { downvotedBy: userId },
          $pull: { upvotedBy: userId }
        };
      }
    } else {
      return res.status(400).send({ message: "Invalid action" });
    }

    await forumPostsCollection.updateOne({ _id: new ObjectId(id) }, updateQuery);
    
    // Keep backward compatible integer counts
    const updatedPost = await forumPostsCollection.findOne({ _id: new ObjectId(id) });
    await forumPostsCollection.updateOne(
       { _id: new ObjectId(id) },
       { $set: { 
           upvotes: updatedPost.upvotedBy ? updatedPost.upvotedBy.length : 0, 
           downvotes: updatedPost.downvotedBy ? updatedPost.downvotedBy.length : 0 
       } }
    );

    res.send({ message: "Vote registered successfully" });
  } catch (error) {
    console.error("Error voting on post:", error);
    res.status(500).send({ message: "Failed to vote", error });
  }
});

// ==========================================
// COMMENTS API
// ==========================================

// Middleware to check comment ownership
const checkCommentOwnership = async (req, res, next) => {
  try {
    const id = req.params.id;
    const authorId = req.body.authorId || req.query.authorId;
    const role = req.body.role || req.query.role;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid comment ID format" });
    }

    const comment = await forumCommentsCollection.findOne({ _id: new ObjectId(id) });
    if (!comment) {
      return res.status(404).send({ message: "Comment not found" });
    }

    if (comment.authorId !== authorId && role !== "admin") {
      return res.status(403).send({ message: "Forbidden: You don't have permission to perform this action" });
    }

    req.comment = comment;
    next();
  } catch (error) {
    console.error("Error in comment authorization middleware:", error);
    res.status(500).send({ message: "Server error during authorization", error });
  }
};

// Get comments for a post
app.get('/forum-posts/:postId/comments', async (req, res) => {
  try {
    const postId = req.params.postId;
    const comments = await forumCommentsCollection
      .find({ postId: postId })
      .sort({ createdAt: 1 }) // Oldest first for comments
      .toArray();

    const usersCollection = db.collection("user");
    for (let comment of comments) {
      if (comment.authorId && comment.authorId.length === 24) {
        const user = await usersCollection.findOne({ _id: new ObjectId(comment.authorId) });
        if (user) {
          comment.author = user.name || comment.author;
          comment.authorImage = user.image || comment.authorImage;
          comment.role = user.role || comment.role;
        }
      }
    }
    res.send(comments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).send({ message: "Failed to fetch comments", error });
  }
});

// Post a comment
app.post('/forum-posts/:postId/comments', async (req, res) => {
  try {
    const postId = req.params.postId;
    const { authorId, text, author, role, authorImage } = req.body;

    if (!authorId || !text) {
      return res.status(400).send({ message: "Missing required fields" });
    }

    const comment = {
      postId,
      authorId,
      author,
      role,
      authorImage,
      text,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await forumCommentsCollection.insertOne(comment);
    
    // Increment comment count on post
    if (ObjectId.isValid(postId)) {
      await forumPostsCollection.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { comments: 1 } }
      );
    }
    
    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).send({ message: "Failed to create comment", error });
  }
});

// Update a comment
app.patch('/forum-comments/:id', checkCommentOwnership, async (req, res) => {
  try {
    const id = req.params.id;
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).send({ message: "Text is required" });
    }

    const result = await forumCommentsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { text, updatedAt: new Date() } }
    );
    res.send(result);
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).send({ message: "Failed to update comment", error });
  }
});

// Delete a comment
app.delete('/forum-comments/:id', checkCommentOwnership, async (req, res) => {
  try {
    const id = req.params.id;
    const comment = req.comment; // attached by middleware
    
    const result = await forumCommentsCollection.deleteOne({ _id: new ObjectId(id) });
    
    // Decrement comment count on post
    if (result.deletedCount === 1 && ObjectId.isValid(comment.postId)) {
      await forumPostsCollection.updateOne(
        { _id: new ObjectId(comment.postId) },
        { $inc: { comments: -1 } }
      );
    }

    res.send(result);
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).send({ message: "Failed to delete comment", error });
  }
});

app.get('/', (req, res) => {
  res.send('Hello World!')
})


app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

