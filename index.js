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
const usersCollection = db.collection("user");
const forumPostsCollection = db.collection("forumPosts");
const forumCommentsCollection = db.collection("forumComments");
const trainerApplicationsCollection = db.collection("trainerApplications");
const classesCollection = db.collection("classes");
const favoriteClassesCollection = db.collection("favoriteClasses");

app.get('/users', async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send({ message: "Failed to fetch users", error });
  }
})

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

// Like a comment
app.patch('/forum-comments/:id/like', async (req, res) => {
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

// ==========================================
// TRAINER APPLICATIONS API
// ==========================================

// Apply to become a trainer
app.post('/trainer-applications', async (req, res) => {
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

    res.status(201).send(result);
  } catch (error) {
    console.error("Error submitting trainer application:", error);
    res.status(500).send({ message: "Failed to submit application", error });
  }
});

// Get all trainer applications (Admin)
app.get('/trainer-applications', async (req, res) => {
  try {
    const status = req.query.status;
    const userId = req.query.userId;
    let query = {};
    
    if (status) query.status = status;
    if (userId) query.userId = userId;
    
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
      
    res.send(applications);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).send({ message: "Failed to fetch applications", error });
  }
});

// Approve or Reject a trainer application (Admin)
app.patch('/trainer-applications/:id', async (req, res) => {
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
app.post('/classes', async (req, res) => {
  try {
    const classData = req.body;
    classData.createdAt = new Date();
    classData.status = "pending"; // Default status
    
    // Ensure numeric fields
    if (classData.price) classData.price = parseFloat(classData.price);
    if (classData.maxAttendees) classData.maxAttendees = parseInt(classData.maxAttendees);
    
    const result = await classesCollection.insertOne(classData);
    res.status(201).send(result);
  } catch (error) {
    console.error("Error creating class:", error);
    res.status(500).send({ message: "Failed to create class", error });
  }
});

// Get classes stats summary
app.get('/classes/stats/summary', async (req, res) => {
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
app.patch('/classes/:id/status', async (req, res) => {
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
    res.send({ message: "Class status updated successfully" });
  } catch (error) {
    console.error("Error updating class status:", error);
    res.status(500).send({ message: "Failed to update class status", error });
  }
});

// Update class details
app.patch('/classes/:id', async (req, res) => {
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
app.delete('/classes/:id', async (req, res) => {
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
app.post('/bookings', async (req, res) => {
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

// Get all bookings (Admin)
app.get('/bookings', async (req, res) => {
  try {
    const bookings = await bookingsCollection.find().sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    res.send(bookings);
  } catch (error) {
    console.error("Error fetching all bookings:", error);
    res.status(500).send({ message: "Failed to fetch bookings", error });
  }
});

// Get all bookings for a user
app.get('/bookings/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const bookings = await bookingsCollection.find({ userId }).sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    res.send(bookings);
  } catch (error) {
    console.error("Error fetching user bookings:", error);
    res.status(500).send({ message: "Failed to fetch bookings", error });
  }
});

// Get all bookings for a trainer's classes
app.get('/bookings/trainer/:trainerId', async (req, res) => {
  try {
    const trainerId = req.params.trainerId;
    const bookings = await bookingsCollection.find({ trainerId }).sort({ createdAt: -1 }).toArray();
    await attachUserInfoToBookings(bookings, db.collection("user"));
    await attachClassInfoToBookings(bookings, classesCollection);
    res.send(bookings);
  } catch (error) {
    console.error("Error fetching trainer bookings:", error);
    res.status(500).send({ message: "Failed to fetch trainer bookings", error });
  }
});

// --- Favorite Classes Routes ---

// Get all favorite class IDs for a user
app.get('/favorite-classes/:userId', async (req, res) => {
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
app.post('/favorite-classes', async (req, res) => {
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
app.delete('/favorite-classes', async (req, res) => {
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
