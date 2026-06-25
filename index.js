const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const port = process.env.PORT || 8000;
app.use(express.json());
app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);


const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


// ==========================================
// JWT AUTHENTICATION MIDDLEWARES
// ==========================================
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL || "http://localhost:3000"}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer")) {
return res.status(401).send({ message: "Unauthorized access: No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
return res.status(401).send({ message: "Unauthorized access: Invalid token format" });
  }

  try {
const { payload } = await jwtVerify(token, JWKS);
req.user = payload;
next();
  } catch (error) {
return res.status(401).send({ message: "Unauthorized access: Invalid or expired token" });
  }
};

const verifyAdmin = async (req, res, next) => {
  const user = req.user;
  if (user?.role !== "admin") {
return res.status(403).send({ message: "Forbidden: Admin access required" });
  }
  next();
};

const verifyTrainer = async (req, res, next) => {
  const user = req.user;
  
  // Double-check the database to ensure we have the absolute latest role,
  // bypassing the potentially stale JWT claim
  let trueRole = user?.role;
  try {
      const dbUser = await usersCollection.findOne({ email: user.email });
      if (dbUser && dbUser.role) {
          trueRole = dbUser.role;
      }
  } catch (err) {
      console.error("Failed to fetch user role from DB in verifyTrainer", err);
  }

  if (trueRole !== "trainer" && trueRole !== "admin") {
    return res.status(403).send({ message: "Forbidden: Trainer access required" });
  }
  next();
};

const verifyNotBlocked = async (req, res, next) => {
  const user = req.user;
  try {
      const dbUser = await usersCollection.findOne({ email: user.email });
      if (dbUser && dbUser.isBlocked) {
          return res.status(403).send({ message: "Action restricted by Admin" });
      }
  } catch (err) {
      console.error("Failed to fetch user block status", err);
  }
  next();
};
// ==========================================

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

const db = client.db("GestorFitness");
const usersCollection = db.collection("user");
const forumPostsCollection = db.collection("forumPosts");
const forumCommentsCollection = db.collection("forumComments");
const trainerApplicationsCollection = db.collection("trainerApplications");
const classesCollection = db.collection("classes");
const favoriteClassesCollection = db.collection("favoriteClasses");
const notificationsCollection = db.collection("notifications");

async function notifyAdmins(message, link = null) {
  try {
    const admins = await usersCollection.find({ role: "admin" }).toArray();
    const notifications = admins.map(admin => ({
      userId: admin._id.toString(),
      message,
      link,
      read: false,
      createdAt: new Date()
    }));
    if (notifications.length > 0) {
      await notificationsCollection.insertMany(notifications);
    }
  } catch (err) {
    console.error("Failed to notify admins", err);
  }
}

async function notifyUser(userId, message, link = null) {
  try {
    await notificationsCollection.insertOne({
      userId: userId.toString(),
      message,
      link,
      read: false,
      createdAt: new Date()
    });
  } catch (err) {
    console.error("Failed to notify user", err);
  }
}


// Get current user profile
app.get('/users/me', verifyToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user) return res.status(404).send({ message: "User not found" });
    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch user profile", error });
  }
});

app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { page, limit = 10, search = "", role = "all" } = req.query;
    let users = await usersCollection.find().toArray();

    if (page) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Compute global stats before filtering
      const stats = {
        totalUsers: users.length,
        totalTrainers: users.filter(u => u.role === "trainer").length,
        totalAdmins: users.filter(u => u.role === "admin").length,
        blockedUsers: users.filter(u => u.isBlocked).length
      };

      // Search filter
      if (search) {
        const s = search.toLowerCase();
        users = users.filter(user => 
          user.name?.toLowerCase().includes(s) || user.email?.toLowerCase().includes(s)
        );
      }

      // Role filter
      if (role && role !== "all") {
        users = users.filter(user => user.role === role);
      }

      const total = users.length;
      const totalPages = Math.ceil(total / limitNum) || 1;
      const skip = (pageNum - 1) * limitNum;
      const paginatedData = users.slice(skip, skip + limitNum);

      return res.send({
        data: paginatedData,
        total,
        totalPages,
        currentPage: pageNum,
        stats
      });
    }

    res.send(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send({ message: "Failed to fetch users", error });
  }
});

app.patch('/users/:id/block', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked: true } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to block user", error });
  }
});

app.patch('/users/:id/unblock', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBlocked: false } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to unblock user", error });
  }
});

// ==========================================
// NOTIFICATIONS API
// ==========================================

app.get('/notifications/:userId', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const notifications = await notificationsCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    res.send(notifications);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch notifications", error });
  }
});

app.patch('/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID format" });
    const result = await notificationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { read: true } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to mark as read", error });
  }
});

app.patch('/notifications/user/:userId/read-all', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await notificationsCollection.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to mark all as read", error });
  }
});

app.delete('/notifications/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID format" });
    const result = await notificationsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete notification", error });
  }
});

app.delete('/notifications/user/:userId', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const result = await notificationsCollection.deleteMany({ userId });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to delete all notifications", error });
  }
});

// Add a new forum post
app.post('/forum-posts', verifyToken, verifyNotBlocked, async (req, res) => {
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
    const search = req.query.search || "";
    const sort = req.query.sort || "newest";
    const role = req.query.role;
    const category = req.query.category;
    const skip = (page - 1) * limit;

    const matchQuery = {};
    if (authorId) {
      matchQuery.authorId = authorId;
    }
    if (role) {
      matchQuery.role = role;
    }
    if (category && category.toLowerCase() !== "all") {
      matchQuery.category = category;
    }

    if (search) {
      matchQuery.$or = [
        { title: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    const sortQuery = sort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };

    const posts = await forumPostsCollection
      .find(matchQuery)
      .sort(sortQuery)
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

    // Dynamically update author info from user collection
    if (post.authorId && post.authorId.length === 24) {
      const usersCollection = db.collection("user");
      const user = await usersCollection.findOne({ _id: new ObjectId(post.authorId) });
      if (user) {
        post.author = user.name || post.author;
        post.authorEmail = user.email || post.authorEmail;
        post.authorImage = user.image || post.authorImage;
        post.role = user.role || post.role;
      }
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
    const authorId = req.user?.id; // better-auth stores id in the JWT payload
    const role = req.user?.role;

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
app.patch('/forum-posts/:id', verifyToken, checkPostOwnership, async (req, res) => {
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
app.delete('/forum-posts/:id', verifyToken, checkPostOwnership, async (req, res) => {
  try {
    const result = await forumPostsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.send(result);
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).send({ message: "Failed to delete post", error });
  }
});

// Vote on a forum post
app.post('/forum-posts/:id/vote', verifyToken, async (req, res) => {
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
    const authorId = req.user?.id;
    const role = req.user?.role;

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
app.post('/forum-posts/:postId/comments', verifyToken, verifyNotBlocked, async (req, res) => {
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
app.patch('/forum-comments/:id', verifyToken, checkCommentOwnership, async (req, res) => {
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

// Like a comment
app.patch('/forum-comments/:id/like', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { userId } = req.body;
    if (!userId) return res.status(400).send({ message: "userId is required" });

    const comment = await forumCommentsCollection.findOne({ _id: new ObjectId(id) });
    if (!comment) return res.status(404).send({ message: "Comment not found" });

    const likedBy = comment.likedBy || [];
    const hasLiked = likedBy.includes(userId);
    
    let updateQuery;
    if (hasLiked) {
      updateQuery = { $pull: { likedBy: userId } };
    } else {
      updateQuery = { $addToSet: { likedBy: userId } };
    }

    const result = await forumCommentsCollection.updateOne(
      { _id: new ObjectId(id) },
      updateQuery
    );
    res.send({ message: hasLiked ? "Unliked" : "Liked", result });
  } catch (error) {
    console.error("Error liking comment:", error);
    res.status(500).send({ message: "Failed to like comment", error });
  }
});

// Delete a comment
app.delete('/forum-comments/:id', verifyToken, checkCommentOwnership, async (req, res) => {
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

// ==========================================
// TRAINER APPLICATIONS API
// ==========================================

// Apply to become a trainer
app.post('/trainer-applications', verifyToken, verifyNotBlocked, async (req, res) => {
  try {
    const application = req.body;
    
    if (!application.userId) {
      return res.status(400).send({ message: "User ID is required" });
    }

    // Check if an application already exists and is pending or approved
    const existing = await trainerApplicationsCollection.findOne({ 
      userId: application.userId, 
      status: { $in: ["pending", "approved"] } 
    });
    
    if (existing) {
      return res.status(400).send({ message: `You already have an application with status: ${existing.status}` });
    }

    application.status = "pending";
    application.createdAt = new Date();
    
    const result = await trainerApplicationsCollection.insertOne(application);
    
    // Update user to indicate they have a pending application
    let userQuery = null;
    if (application.userId) {
      if (ObjectId.isValid(application.userId) && (typeof application.userId === 'string' && application.userId.length === 24)) {
        userQuery = { _id: new ObjectId(application.userId) };
      } else {
        userQuery = { _id: application.userId };
      }
    }

    if (userQuery) {
      await usersCollection.updateOne(
        userQuery,
        { $set: { trainerApplicationStatus: "pending" } }
      );
    }

    // Notify admins
    await notifyAdmins(`A new trainer application was submitted and is pending review.`, "/dashboard/admin/trainers");

    res.status(201).send(result);
  } catch (error) {
    console.error("Error submitting trainer application:", error);
    res.status(500).send({ message: "Failed to submit application", error });
  }
});

// Get all trainer applications
app.get('/trainer-applications', verifyToken, async (req, res) => {
  try {
    const status = req.query.status;
    const requestedUserId = req.query.userId;
    let query = {};
    
    // If not admin, restrict to their own applications
    if (req.user.role !== "admin") {
      if (requestedUserId && requestedUserId !== req.user.id) {
        return res.status(403).send({ message: "Forbidden: You can only fetch your own applications" });
      }
      // Force the query to only return their own applications
      query = { userId: req.user.id };
    } else {
      query = {};
      if (requestedUserId) query.userId = requestedUserId;
    }
    
    const applications = await trainerApplicationsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    // Dynamically attach user info (image)
    const usersCollection = db.collection("user");
    for (let app of applications) {
      if (app.userId) {
        let userQuery;
        if (ObjectId.isValid(app.userId) && (typeof app.userId === 'string' && app.userId.length === 24)) {
          userQuery = { _id: new ObjectId(app.userId) };
        } else {
          userQuery = { _id: app.userId };
        }
        const user = await usersCollection.findOne(userQuery);
        if (user && user.image) {
          app.image = user.image;
        }
      }
    }

    const { page, limit = 10 } = req.query;
    if (page) {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      
      const stats = {
        totalApps: applications.length,
        pending: applications.filter(a => a.status === "pending").length,
        rejected: applications.filter(a => a.status === "rejected").length,
      };

      let filteredApps = applications;
      if (status) {
        filteredApps = filteredApps.filter(a => a.status === status);
      }

      const total = filteredApps.length;
      const totalPages = Math.ceil(total / limitNum) || 1;
      const skip = (pageNum - 1) * limitNum;
      const paginatedData = filteredApps.slice(skip, skip + limitNum);

      return res.send({
        data: paginatedData,
        total,
        totalPages,
        currentPage: pageNum,
        stats
      });
    }

    let filteredApps = applications;
    if (status) {
      filteredApps = filteredApps.filter(a => a.status === status);
    }
    res.send(filteredApps);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Failed to fetch applications", error });
  }
});

// Approve or Reject a trainer application (Admin)
app.patch('/trainer-applications/:id', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, feedback } = req.body;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid application ID format" });
    }
    
    if (status !== "approved" && status !== "rejected") {
      return res.status(400).send({ message: "Status must be 'approved' or 'rejected'" });
    }

    const application = await trainerApplicationsCollection.findOne({ _id: new ObjectId(id) });
    if (!application) {
      return res.status(404).send({ message: "Application not found" });
    }

    // Update application
    await trainerApplicationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, feedback, updatedAt: new Date() } }
    );
    
    // Update user role and status
    let userQuery = null;
    if (application.userId) {
      if (ObjectId.isValid(application.userId) && (typeof application.userId === 'string' && application.userId.length === 24)) {
        userQuery = { _id: new ObjectId(application.userId) };
      } else {
        userQuery = { _id: application.userId }; // better-auth stores _id as string
      }
    }

    if (userQuery) {
      const updateDoc = {
        $set: { trainerApplicationStatus: status, feedback: feedback || "" }
      };
      
      if (status === "approved") {
        updateDoc.$set.role = "trainer";
        if (application.specialty) updateDoc.$set.specialty = application.specialty;
        if (application.experience !== undefined) updateDoc.$set.experience = application.experience;
        if (application.bio) updateDoc.$set.bio = application.bio;
      } else if (status === "rejected") {
        updateDoc.$set.role = "user";
        updateDoc.$unset = { specialty: "", experience: "", bio: "" };
      }
      
      await usersCollection.updateOne(userQuery, updateDoc);
    }
    
    if (application.userId) {
      const redirectLink = status === "rejected" ? "/dashboard/user/apply-trainer" : "/dashboard/user";
      await notifyUser(
        application.userId,
        `Your trainer application has been ${status}. ${status === 'rejected' ? 'Check feedback for details.' : 'Welcome to the team!'}`,
        redirectLink
      );
    }
    
    res.send({ message: `Application ${status} successfully` });
  } catch (error) {
    console.error("Error updating application:", error);
    res.status(500).send({ message: "Failed to update application", error });
  }
});

// ----------------------------------------------------------------------
// CLASSES ENDPOINTS
// ----------------------------------------------------------------------

// Create a new class
app.post('/classes', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const classData = req.body;
    classData.createdAt = new Date();
    classData.status = "pending"; // Default status
    
    // Ensure numeric fields
    if (classData.price) classData.price = parseFloat(classData.price);
    if (classData.maxAttendees) classData.maxAttendees = parseInt(classData.maxAttendees);
    
    const result = await classesCollection.insertOne(classData);
    
    // Notify admins about the new class
    await notifyAdmins(`A new class "${classData.title}" was submitted by ${classData.trainerName || 'a trainer'} and is awaiting review.`, "/dashboard/admin/classes");
    
    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating class:", error);
    res.status(500).send({ message: "Failed to create class", error });
  }
});

// Get classes stats summary
app.get('/classes/stats/summary', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const { trainerId } = req.query;
    const query = {};
    if (trainerId) query.trainerId = trainerId;

    const totalClasses = await classesCollection.countDocuments(query);
    const pendingCount = await classesCollection.countDocuments({ ...query, status: "pending" });

    const bookingsQuery = {};
    if (trainerId) bookingsQuery.trainerId = trainerId;
    const totalStudents = await db.collection("bookings").countDocuments(bookingsQuery);

    let avgPrice = 0;
    const classes = await classesCollection.find(query).project({ price: 1 }).toArray();
    if (classes.length > 0) {
      const sum = classes.reduce((acc, cls) => acc + (parseFloat(cls.price) || 0), 0);
      avgPrice = sum / classes.length;
    }

    res.send({
      totalClasses,
      totalStudents,
      avgPrice,
      pendingCount
    });
  } catch (error) {
    console.error("Error fetching class stats:", error);
    res.status(500).send({ message: "Failed to fetch class stats", error });
  }
});

// Get all classes with optional filters
app.get('/classes', async (req, res) => {
  try {
    const { status, trainerId, category } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // Default large for backwards compat if needed
    const search = req.query.search || "";
    const skip = (page - 1) * limit;

    const query = {};
    if (status) query.status = status;
    if (trainerId) query.trainerId = trainerId;
    if (category && category !== "All") query.category = category;

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { trainerName: { $regex: search, $options: "i" } }
      ];
    }

    const totalClasses = await classesCollection.countDocuments(query);
    const totalPages = Math.ceil(totalClasses / limit);

    const classes = await classesCollection.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Dynamically attach trainer info and enrolled counts
    const usersCollection = db.collection("user");
    const bookingsCollection = db.collection("bookings");
    for (let cls of classes) {
      if (cls.trainerId && cls.trainerId.length === 24) {
        const trainer = await usersCollection.findOne({ _id: new ObjectId(cls.trainerId) });
        if (trainer) {
          cls.trainerName = trainer.name || cls.trainerName;
          cls.trainerImage = trainer.image || cls.trainerImage;
        }
      }
      
      // Calculate enrolledCount
      const enrolledCount = await bookingsCollection.countDocuments({ classId: cls._id.toString() });
      cls.enrolledCount = enrolledCount;
    }

    res.send({
      classes,
      totalClasses,
      totalPages,
      currentPage: page
    });
  } catch (error) {
    console.error("Error fetching classes:", error);
    res.status(500).send({ message: "Failed to fetch classes", error });
  }
});

// Get class by ID
app.get('/classes/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid class ID format" });
    }

    const cls = await classesCollection.findOne({ _id: new ObjectId(id) });
    if (!cls) {
      return res.status(404).send({ message: "Class not found" });
    }

    // Dynamically attach trainer info
    const usersCollection = db.collection("user");
    const bookingsCollection = db.collection("bookings");
    if (cls.trainerId && cls.trainerId.length === 24) {
      const trainer = await usersCollection.findOne({ _id: new ObjectId(cls.trainerId) });
      if (trainer) {
        cls.trainerName = trainer.name || cls.trainerName;
        cls.trainerImage = trainer.image || cls.trainerImage;
      }
    }
      
    const enrolledCount = await bookingsCollection.countDocuments({ classId: cls._id.toString() });
    cls.enrolledCount = enrolledCount;

    res.send(cls);
  } catch (error) {
    console.error("Error fetching class by ID:", error);
    res.status(500).send({ message: "Failed to fetch class", error });
  }
});

// Update class status
app.patch('/classes/:id/status', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, feedback } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid class ID format" });
    }
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).send({ message: "Invalid status" });
    }

    const updateDoc = {
      $set: { status, updatedAt: new Date() }
    };
    if (feedback !== undefined) {
      updateDoc.$set.feedback = feedback;
    }

    const result = await classesCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Class not found" });
    }
    
    const cls = await classesCollection.findOne({ _id: new ObjectId(id) });
    if (cls && cls.trainerId) {
      await notifyUser(
        cls.trainerId,
        `Your class "${cls.title}" has been ${status}. ${status === 'rejected' ? 'Check feedback for details.' : ''}`,
        "/dashboard/trainer"
      );
    }
    
    res.send({ message: "Class status updated successfully" });
  } catch (error) {
    console.error("Error updating class status:", error);
    res.status(500).send({ message: "Failed to update class status", error });
  }
});

// Update class details
app.patch('/classes/:id', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid class ID format" });
    }

    const { _id, ...updateData } = req.body;
    updateData.updatedAt = new Date();

    const result = await classesCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "Class not found" });
    }
    res.send({ message: "Class updated successfully" });
  } catch (error) {
    console.error("Error updating class:", error);
    res.status(500).send({ message: "Failed to update class", error });
  }
});

// Delete a class
app.delete('/classes/:id', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid class ID format" });
    }

    const result = await classesCollection.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Class not found" });
    }
    res.send({ message: "Class deleted successfully" });
  } catch (error) {
    console.error("Error deleting class:", error);
    res.status(500).send({ message: "Failed to delete class", error });
  }
});

// --- Bookings Routes ---

const bookingsCollection = db.collection("bookings");

// Create a new booking
app.post('/bookings', verifyToken, verifyNotBlocked, async (req, res) => {
  try {
    const bookingData = req.body;
    
    // Ensure we don't insert duplicate booking based on transactionId or sessionId
    if (bookingData.sessionId) {
      const existing = await bookingsCollection.findOne({ sessionId: bookingData.sessionId });
      if (existing) {
        return res.status(200).send({ message: "Booking already exists", result: existing });
      }
    }
    
    bookingData.createdAt = new Date();
    bookingData.status = "paid";

    const result = await bookingsCollection.insertOne(bookingData);

    // Notify trainer about the new booking
    if (bookingData.trainerId) {
      await notifyUser(
        bookingData.trainerId,
        `You have a new student for your class "${bookingData.title}".`,
        "/dashboard/trainer/students"
      );
    }

    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).send({ message: "Failed to create booking", error });
  }
});

// Helper to attach user info to bookings
async function attachUserInfoToBookings(bookings, usersCollection) {
  for (let booking of bookings) {
    let userQuery = null;
    if (booking.userId) {
      if (ObjectId.isValid(booking.userId) && (typeof booking.userId === 'string' && booking.userId.length === 24)) {
        userQuery = { _id: new ObjectId(booking.userId) };
      } else {
        userQuery = { _id: booking.userId };
      }
      
      if (userQuery) {
        const user = await usersCollection.findOne(userQuery);
        if (user) {
          booking.userEmail = user.email;
          booking.userName = user.name;
          booking.userImage = user.image;
        }
      }
    }
  }
  return bookings;
}

// Helper to attach class info to bookings
async function attachClassInfoToBookings(bookings, classesCollection) {
  for (let booking of bookings) {
    if (booking.classId) {
      let classQuery = null;
      if (ObjectId.isValid(booking.classId) && (typeof booking.classId === 'string' && booking.classId.length === 24)) {
        classQuery = { _id: new ObjectId(booking.classId) };
      } else {
        classQuery = { _id: booking.classId };
      }
      
      if (classQuery) {
        const cls = await classesCollection.findOne(classQuery);
        if (cls) {
          booking.classDetails = cls;
        }
      }
    }
  }
  return bookings;
}

// Helper to filter, compute stats, and paginate bookings
function processBookings(bookings, query, currentUserEmail, role) {
  const pageNum = parseInt(query.page);
  const limitNum = parseInt(query.limit);
  
  // If no pagination requested, just return as array for backward compatibility
  if (!query.page) {
    return bookings;
  }

  let filtered = bookings;

  // Search filter
  if (query.search) {
    const s = query.search.toLowerCase();
    filtered = filtered.filter(tx => {
      const idMatch = tx.transactionId?.toLowerCase().includes(s) || tx.sessionId?.toLowerCase().includes(s);
      const emailMatch = tx.userEmail?.toLowerCase().includes(s) || tx.userName?.toLowerCase().includes(s);
      const titleMatch = (tx.title || tx.classDetails?.title)?.toLowerCase().includes(s);
      return idMatch || emailMatch || titleMatch;
    });
  }

  // Date filter
  if (query.dateFilter && query.dateFilter !== "all") {
    const days = parseInt(query.dateFilter);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    filtered = filtered.filter(tx => {
      if (!tx.createdAt) return false;
      return new Date(tx.createdAt) >= cutoffDate;
    });
  }

  // Compute stats
  const isIncome = (tx) => {
    if (role === "user") return false;
    return !currentUserEmail || tx.userEmail !== currentUserEmail;
  };
  const isExpense = (tx) => {
    if (role === "user") return true;
    return currentUserEmail && tx.userEmail === currentUserEmail;
  };

  const incomeTxs = filtered.filter(isIncome);
  const expenseTxs = filtered.filter(isExpense);

  const stats = {
    totalRevenue: filtered.reduce((sum, tx) => sum + (tx.price || 0), 0),
    totalEarnings: incomeTxs.reduce((sum, tx) => sum + (tx.price || 0), 0),
    totalSpent: expenseTxs.reduce((sum, tx) => sum + (tx.price || 0), 0),
    totalTransactions: filtered.length,
    uniqueUsers: new Set(filtered.map(tx => tx.userEmail).filter(Boolean)).size,
    incomeCount: incomeTxs.length,
    expenseCount: expenseTxs.length,
    totalStudents: filtered.length,
    paidEnrollments: filtered.filter(s => s.status === "paid").length,
    uniqueClassesCount: new Set(filtered.map(s => s.title || s.classDetails?.title).filter(Boolean)).size
  };

  const total = filtered.length;
  const totalPages = Math.ceil(total / limitNum) || 1;
  const skip = (pageNum - 1) * limitNum;
  const paginatedData = filtered.slice(skip, skip + limitNum);

  return {
    data: paginatedData,
    total,
    totalPages,
    currentPage: pageNum,
    stats
  };
}

// Get all bookings (Admin)
app.get('/bookings', verifyToken, verifyAdmin, async (req, res) => {
  try {
    const bookings = await bookingsCollection.find().sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    const result = processBookings(bookings, req.query, req.user?.email, "admin");
    res.send(result);
  } catch (error) {
    console.error("Error fetching all bookings:", error);
    res.status(500).send({ message: "Failed to fetch bookings", error });
  }
});

// Get all bookings for a user
app.get('/bookings/user/:userId', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const bookings = await bookingsCollection.find({ userId }).sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    const result = processBookings(bookings, req.query, req.user?.email, "user");
    res.send(result);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).send({ message: "Failed to fetch bookings", error });
  }
});

// Get combined bookings for a trainer (sales and purchases)
app.get('/bookings/trainer-and-user/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const bookings = await bookingsCollection.find({ 
      $or: [{ userId: id }, { trainerId: id }] 
    }).sort({ createdAt: -1 }).toArray();
    
    // Deduplicate by _id or sessionId just in case
    const uniqueBookingsMap = new Map();
    for (const b of bookings) {
      uniqueBookingsMap.set(b._id ? b._id.toString() : b.sessionId, b);
    }
    const uniqueBookings = Array.from(uniqueBookingsMap.values());
    uniqueBookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    await attachUserInfoToBookings(uniqueBookings, db.collection("user"));
    await attachClassInfoToBookings(uniqueBookings, classesCollection);
    const result = processBookings(uniqueBookings, req.query, req.user?.email, "trainer");
    res.send(result);
  } catch (error) {
    console.error("Error fetching combined bookings:", error);
    res.status(500).send({ message: "Failed to fetch combined bookings", error });
  }
});

// Get all bookings for a trainer's classes
app.get('/bookings/trainer/:trainerId', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const trainerId = req.params.trainerId;
    const bookings = await bookingsCollection.find({ trainerId }).sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    const result = processBookings(bookings, req.query, req.user?.email, "trainer");
    res.send(result);
  } catch (error) {
    console.error("Error fetching trainer bookings:", error);
    res.status(500).send({ message: "Failed to fetch trainer bookings", error });
  }
});

// Get attendees for a specific class
app.get('/bookings/class/:classId/attendees', verifyToken, verifyTrainer, async (req, res) => {
  try {
    const classId = req.params.classId;
    const bookings = await bookingsCollection.find({ classId }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    const attendees = bookings.map(b => ({
      _id: b.userId,
      name: b.userName,
      email: b.userEmail,
      image: b.userImage,
      bookingId: b._id,
      bookedAt: b.createdAt
    }));
    // Filter duplicates just in case
    const uniqueAttendees = Array.from(new Map(attendees.map(a => [a._id, a])).values());
    res.send(uniqueAttendees);
  } catch (error) {
    console.error("Error fetching class attendees:", error);
    res.status(500).send({ message: "Failed to fetch class attendees", error });
  }
});

// --- Favorite Classes Routes ---

// Get all favorite class IDs for a user
app.get('/favorite-classes/:userId', verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const favorites = await favoriteClassesCollection.find({ userId }).toArray();
    const classIds = favorites.map(f => f.classId);
    res.send(classIds);
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res.status(500).send({ message: "Failed to fetch favorites", error });
  }
});

// Add a class to favorites
app.post('/favorite-classes', verifyToken, async (req, res) => {
  try {
    const { userId, classId } = req.body;
    if (!userId || !classId) {
      return res.status(400).send({ message: "userId and classId are required" });
    }
    
    // Check for duplicate
    const existing = await favoriteClassesCollection.findOne({ userId, classId });
    if (existing) {
      return res.status(400).send({ message: "Class is already in favorites" });
    }
    
    const result = await favoriteClassesCollection.insertOne({ userId, classId, createdAt: new Date() });
    res.send({ message: "Added to favorites", result });
  } catch (error) {
    console.error("Error adding favorite:", error);
    res.status(500).send({ message: "Failed to add favorite", error });
  }
});

// Remove a class from favorites
app.delete('/favorite-classes', verifyToken, async (req, res) => {
  try {
    const { userId, classId } = req.query;
    if (!userId || !classId) {
      return res.status(400).send({ message: "userId and classId are required" });
    }
    
    const result = await favoriteClassesCollection.deleteOne({ userId, classId });
    if (result.deletedCount === 0) {
      return res.status(404).send({ message: "Favorite not found" });
    }
    res.send({ message: "Removed from favorites" });
  } catch (error) {
    console.error("Error removing favorite:", error);
    res.status(500).send({ message: "Failed to remove favorite", error });
  }
});

app.get("/", (req, res) => {
  res.send("GestorFitness Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
