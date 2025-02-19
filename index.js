require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const port = process.env.PORT || 8000;

// middlewere
app.use(
  cors({
    origin: ["http://localhost:5173", "https://medimart-678e7.web.app"],
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.c8olx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("mediMart");
    const medicinesCollection = db.collection("medicine");
    const cartsCollection = db.collection("carts");
    const usersCollection = db.collection("users");
    const adsCollection = db.collection("ads");
    const categorysCollection = db.collection("categorys");
    const ordersCollection = db.collection("orders");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res.send({ token });
    });

    //middlewere verification
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Forbidden Access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Forbidden Access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Forbidden Access! Admin Only Actions!" });

      next();
    };

    // verify seller middleware
    const verifySeller = async (req, res, next) => {
      const email = req.user?.email;
      const query = { email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "seller")
        return res
          .status(403)
          .send({ message: "Forbidden Access! Seller Only Actions!" });

      next();
    };

    // Create or update user
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;

      if (!email || !email.includes("@")) {
        return res.status(400).send({ message: "Valid email is required" });
      }

      try {
        const result = await usersCollection.updateOne(
          { email },
          { $set: user },
          { upsert: true }
        );
        res.status(200).send(result);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ message: "Failed to save user" });
      }
    });

    //get all user { email: { $ne: req.decoded.email } }
    app.get("/all-users", verifyToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    // get user role by email
    app.get("/users-role/:email",  async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);

      res.send({ role: result?.role });
    });

    // update user role
    app.patch("/user/role/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;

      const filter = { email: email };
      const updateDoc = {
        $set: { role },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // add medicine in database
    app.post("/medicine",  verifyToken,  async (req, res) => {
      const medicine = req.body;
      const result = await medicinesCollection.insertOne(medicine);
      res.send(result);
    });

    // get all medicine for user in shop
    app.get("/shop-medicine", async (req, res) => {
      

      const result = await medicinesCollection.find().toArray();
      res.send(result);
    });

    // get all medicine by user email id
    app.get("/medicines/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "seller.email": email };
      const result = await medicinesCollection.find(query).toArray();
      res.send(result);
    });

    // delete medicine by id
    app.delete("/delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await medicinesCollection.deleteOne(query);
      res.send(result);
    });

    // post cart in cart collection add to cart
    app.post("/cart", async (req, res) => {
      const cart = req.body;
      const { cartId, buyerEmail } = cart;
      const existingCart = await cartsCollection.findOne({
        cartId,
        buyerEmail,
      });
      if (existingCart) {
        return res
          .status(400)
          .send({ message: "This product is already in your cart!" });
      }
      const result = await cartsCollection.insertOne(cart);
      res.send(result);
    });

    // get all cart by email
    app.get("/carts/:email", async (req, res) => {
      const email = req.params.email;
      const query = { buyerEmail: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });

    // cart delete api create
    app.delete("/detele-cart/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    // Manage cart price, quqntity and count based update
    app.patch("/update-count/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { action } = req.body;
      const filter = { _id: new ObjectId(id) };

      const cart = await cartsCollection.findOne(filter);
      if (!cart) {
        return res.status(404).send({ message: "Cart item not found!" });
      }
      const perUnitPrice = cart.unitPrice;

      let updateDoc = {};
      if (action === "increase") {
        if (cart.quantity <= 0) {
          return res.status(400).send({ message: "Stock not available!" });
        }
        updateDoc = {
          $set: {
            count: cart.count + 1,
            price: (cart.count + 1) * perUnitPrice,
          },
          $inc: { quantity: -1 },
        };
      } else if (action === "decrease") {
        if (cart.count <= 0) {
          return res.status(400).send({ message: "Cannot decrease below 0!" });
        }

        updateDoc = {
          $set: {
            count: cart.count - 1,
            price: (cart.count - 1) * perUnitPrice,
          },
          $inc: { quantity: 1 },
        };
      } else {
        return res.status(400).send({ message: "Invalid action!" });
      }

      const result = await cartsCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    //ask for ads medicine seller
    app.post("/ads-medicine", verifyToken, async (req, res) => {
      const ads = req.body;
      const result = await adsCollection.insertOne(ads);
      res.send(result);
    });

    // get all ads request seller
    app.get("/ads-request/:email",  verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { sellerEmail: email };
      const result = await adsCollection.find(query).toArray();
      res.send(result);
    });

    // delete ads request seller
    app.delete("/ads-delete/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await adsCollection.deleteOne(query);
      res.send(result);
    });

    //get all banner request for admin
    app.get("/all-banner", verifyToken, async (req, res) => {
      const result = await adsCollection.find().toArray();
      res.send(result);
    });

    // update status of banner by admin
    app.patch("/banner/status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: { status },
      };
      const result = await adsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // get all active banner for user
    app.get("/active-banner", async (req, res) => {
      const result = await adsCollection.find({ status: "active" }).toArray();
      res.send(result);
    });

    // post category in database admin
    app.post("/category", verifyToken, async (req, res) => {
      const category = req.body;
      const result = await categorysCollection.insertOne(category);
      res.send(result);
    });

    // get all category for admin route
    app.get("/categorys/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { adminEmail: email };
      const result = await categorysCollection.find(query).toArray();
      res.send(result);
    });

    // get all gategory for user
    app.get("/categorys", async (req, res) => {
      const result = await categorysCollection.find().toArray();
      res.send(result);
    });

    // detele category request
    app.delete("/delete/category/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await categorysCollection.deleteOne(query);
      res.send(result);
    });

    //get category by specific category
    app.get("/medicine/:category", async (req, res) => {
      const category = req.params.category;
      const filter = { category: category };
      const result = await medicinesCollection.find(filter).toArray();
      res.send(result);
    });

    // cart delete api create
    app.delete("/detele-carts/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = {
        buyerEmail: email,
      };
      const result = await cartsCollection.deleteMany(query);
      res.send(result);
    });

    // Create payment intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { email } = req.body;
      const cartItems = await cartsCollection
        .find({ buyerEmail: email })
        .toArray();
      if (!cartItems || cartItems.length === 0) {
        return res.status(400).send({ message: "Cart not found!" });
      }
      const exchangeRate = 110;

      const totalPriceInBDT = cartItems.reduce(
        (acc, item) => acc + item.unitPrice * item.count,
        0
      );

      const totalPriceInUSD = (totalPriceInBDT / exchangeRate).toFixed(2);

      const { client_secret, amount } = await stripe.paymentIntents.create({
        amount: Math.round(totalPriceInUSD * 100),
        currency: "usd",
        automatic_payment_methods: { enabled: true },
      });

      res.send({ clientSecret: client_secret, amount: amount });
    });

    // order post api
    app.post("/order", verifyToken, async (req, res) => {
      const order = req.body;
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });

    // get all order  by email
    app.get("/orders-history/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      const query = {
        $or: [{ buyerEmail: email }, { sellerEmail: email }],
      };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    //handle order status
    app.patch("/order/status/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!status) {
        return res.status(400).send({ message: "Status is required" });
      }

      try {
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: { status },
        };

        const result = await ordersCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Order not found" });
        }

        res.status(200).send(result);
      } catch (error) {
        console.error("Error updating order status:", error);
        res.status(500).send({ message: "Failed to update order status" });
      }
    });

    // seler Revenue
    app.get("/seller/revenue/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const salesData = await ordersCollection
        .aggregate([
          {
            $match: {
              sellerEmail: email,
            },
          },
          {
            $group: {
              _id: "$status",
              totalRevenue: { $sum: "$totalPrice" },
            },
          },
        ])
        .toArray();

      const result = salesData.reduce(
        (acc, curr) => {
          if (curr._id === "paid") acc.paid += curr.totalRevenue;
          if (curr._id === "pending") acc.pending += curr.totalRevenue;
          return acc;
        },
        { paid: 0, pending: 0 }
      );

      res.status(200).send(result);
    });

    // Admin Revenue
    app.get("/admin/revenue", verifyToken, async (req, res) => {
      const salesData = await ordersCollection
        .aggregate([
          {
            $group: {
              _id: "$status",
              totalRevenue: { $sum: "$totalPrice" },
            },
          },
        ])
        .toArray();
      const result = { paid: 0, pending: 0 };
      salesData.forEach((data) => {
        if (data._id === "paid") result.paid = data.totalRevenue;
        if (data._id === "pending") result.pending = data.totalRevenue;
      });
      res.status(200).send(result);
    });

    // Get all order data
    app.get("/admin-orders", verifyToken, async (req, res) => {
      const orders = await ordersCollection.find().toArray();
      res.send(orders);
    });

    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hello Medi mart");
});

app.listen(port, () => {
  console.log("Medi Mart is Running");
});
